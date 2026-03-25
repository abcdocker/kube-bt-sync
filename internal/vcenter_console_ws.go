package internal

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/vim25/types"
)

var consoleUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 8192,
	CheckOrigin: func(r *http.Request) bool { return true },
}

func handleVCenterConsoleWS(c *gin.Context, vc *vCenterClient) {
	if !vc.cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	moref := strings.TrimSpace(c.Param("moref"))
	ctx := c.Request.Context()
	client, err := vc.getClient(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	vm := object.NewVirtualMachine(client.Client, types.ManagedObjectReference{Type: "VirtualMachine", Value: moref})
	state, err := vm.PowerState(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if state != types.VirtualMachinePowerStatePoweredOn {
		c.JSON(http.StatusBadRequest, gin.H{"error": "虚拟机需处于开机状态才能打开 WebMKS 控制台"})
		return
	}
	ticket, err := vm.AcquireTicket(ctx, string(types.VirtualMachineTicketTypeWebmks))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "获取 WebMKS 票据失败: " + err.Error()})
		return
	}
	port := ticket.Port
	if port == 0 {
		port = 443
	}
	wssURL := fmt.Sprintf("wss://%s:%d/ticket/%s", ticket.Host, port, url.PathEscape(ticket.Ticket))

	dialer := websocket.Dialer{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: vc.cfg.VCenterInsecure,
			ServerName:         ticket.Host,
		},
	}
	remote, _, err := dialer.Dial(wssURL, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "连接 ESXi WebMKS 失败: " + err.Error()})
		return
	}
	defer remote.Close()

	conn, err := consoleUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("vCenter console WebSocket 升级失败: %v", err)
		return
	}
	defer conn.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := remote.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		for {
			mt, data, err := remote.ReadMessage()
			if err != nil {
				return
			}
			if err := conn.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}()
	wg.Wait()
}
