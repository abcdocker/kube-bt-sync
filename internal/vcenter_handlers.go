package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/vmware/govmomi/find"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/types"
)

func handleVCenterStatus(c *gin.Context, cfg Config) {
	c.JSON(http.StatusOK, gin.H{
		"configured":     cfg.vCenterConfigured(),
		"vcenterUrlHint": maskVCenterURL(cfg.VCenterURL),
	})
}

func maskVCenterURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = strings.TrimPrefix(raw, "https://")
	raw = strings.TrimPrefix(raw, "http://")
	if i := strings.Index(raw, "/"); i > 0 {
		raw = raw[:i]
	}
	if i := strings.Index(raw, "@"); i >= 0 {
		raw = raw[i+1:]
	}
	return raw
}

func vcenterVMListRedisKey(cfg Config) string {
	p := strings.TrimSpace(cfg.RedisKeyPrefix)
	if p == "" {
		return "kbts:vcenter:vms:snapshot"
	}
	return p + ":vcenter:vms:snapshot"
}

func handleVCenterVMs(c *gin.Context, app *ServerApp) {
	vc := app.VCenter()
	cfg := vc.cfg
	if !cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	ctx := c.Request.Context()
	force := c.Query("refresh") == "1" || c.Query("refresh") == "true"
	ttl := time.Duration(cfg.VCenterCacheTTLSec) * time.Second
	if ttl <= 0 {
		ttl = 120 * time.Second
	}
	key := vcenterVMListRedisKey(cfg)
	if !force {
		if rdb := app.Redis(); rdb != nil {
			if s, err := rdb.Get(ctx, key); err == nil && s != "" {
				c.Header("X-VCenter-VM-Cache", "redis-hit")
				c.Data(http.StatusOK, "application/json", []byte(s))
				return
			}
		}
	}

	client, err := vc.getClient(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	f := find.NewFinder(client.Client, true)
	dcs, err := f.DatacenterList(ctx, "*")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "列出数据中心失败: " + err.Error()})
		return
	}
	out := make([]gin.H, 0)
	for _, dc := range dcs {
		f.SetDatacenter(dc)
		vms, err := f.VirtualMachineList(ctx, "*")
		if err != nil {
			continue
		}
		for _, vm := range vms {
			var m mo.VirtualMachine
			if err := vm.Properties(ctx, vm.Reference(), []string{"summary"}, &m); err != nil {
				continue
			}
			if m.Summary.Config.Name == "" {
				continue
			}
			ps := string(m.Summary.Runtime.PowerState)
			cpu := m.Summary.Config.NumCpu
			mem := int64(m.Summary.Config.MemorySizeMB)
			qs := m.Summary.QuickStats
			rt := m.Summary.Runtime
			cpuUse := qs.OverallCpuUsage
			maxCpu := rt.MaxCpuUsage
			cpuPct := 0.0
			if maxCpu > 0 {
				cpuPct = float64(cpuUse) / float64(maxCpu) * 100
				if cpuPct > 100 {
					cpuPct = 100
				}
			}
			guestMem := qs.GuestMemoryUsage
			hostMem := qs.HostMemoryUsage
			memUse := guestMem
			if memUse <= 0 && hostMem > 0 {
				memUse = hostMem
			}
			maxMem := rt.MaxMemoryUsage
			memPct := 0.0
			if maxMem > 0 && memUse >= 0 {
				memPct = float64(memUse) / float64(maxMem) * 100
				if memPct > 100 {
					memPct = 100
				}
			} else if mem > 0 && guestMem > 0 {
				memPct = float64(guestMem) / float64(mem) * 100
				if memPct > 100 {
					memPct = 100
				}
			}
			out = append(out, gin.H{
				"moref":              vm.Reference().Value,
				"name":               m.Summary.Config.Name,
				"powerState":         ps,
				"guestId":            m.Summary.Config.GuestId,
				"cpu":                cpu,
				"memoryMB":           mem,
				"ip":                 guestIP(m.Summary),
				"overallStatus":      string(m.Summary.OverallStatus),
				"cpuUsageMHz":        cpuUse,
				"cpuCapacityMHz":     maxCpu,
				"cpuUsagePercent":    roundPct1(cpuPct),
				"memoryUsageMB":      memUse,
				"memoryMaxMB":        maxMem,
				"memoryUsagePercent": roundPct1(memPct),
				"uptimeSec":          qs.UptimeSeconds,
			})
		}
	}
	payload, err := json.Marshal(gin.H{"vms": out})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rdb := app.Redis(); rdb != nil {
		_ = rdb.Set(ctx, key, payload, ttl)
	}
	if kv := app.PlatformKV(); kv != nil {
		_ = kv.Set("vcenter:vms:snapshot", string(payload))
		if app.Cfg().RuntimeDualWriteRedis {
			if rdb := app.Redis(); rdb != nil {
				mctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
				defer cancel()
				_ = MirrorPlatformKVToRedis(mctx, rdb, app.Cfg(), kv.Snapshot())
			}
		}
	}
	c.Header("X-VCenter-VM-Cache", "miss")
	c.Data(http.StatusOK, "application/json", payload)
}

func guestIP(s types.VirtualMachineSummary) string {
	if s.Guest != nil && s.Guest.IpAddress != "" {
		return s.Guest.IpAddress
	}
	return "—"
}

func handleVCenterVMDetail(c *gin.Context, vc *vCenterClient) {
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
	var m mo.VirtualMachine
	if err := vm.Properties(ctx, vm.Reference(), []string{
		"summary", "runtime", "config", "guest", "resourcePool", "datastore", "network",
	}, &m); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "虚拟机不存在或无权访问: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, vmDetailJSON(&m))
}

func vmDetailJSON(m *mo.VirtualMachine) gin.H {
	h := gin.H{
		"moref": m.Self.Value,
	}
	if m.Summary.Config.Name != "" {
		h["name"] = m.Summary.Config.Name
		h["guestId"] = m.Summary.Config.GuestId
		h["uuid"] = m.Summary.Config.Uuid
		h["cpu"] = m.Summary.Config.NumCpu
		h["memoryMB"] = m.Summary.Config.MemorySizeMB
		h["template"] = m.Summary.Config.Template
	}
	if m.Config != nil {
		if m.Config.CpuHotAddEnabled != nil {
			h["cpuHotAddEnabled"] = *m.Config.CpuHotAddEnabled
		}
		if m.Config.MemoryHotAddEnabled != nil {
			h["memoryHotAddEnabled"] = *m.Config.MemoryHotAddEnabled
		}
		if disks := virtualDisksFromConfig(m.Config); len(disks) > 0 {
			h["disks"] = disks
		}
	}
	h["powerState"] = string(m.Summary.Runtime.PowerState)
	h["bootTime"] = formatTimePtr(m.Summary.Runtime.BootTime)
	if m.Summary.Runtime.Host != nil {
		h["hostMoRef"] = m.Summary.Runtime.Host.Value
	}
	if m.Summary.Guest != nil {
		h["guest"] = gin.H{
			"ip":                 m.Summary.Guest.IpAddress,
			"hostname":           m.Summary.Guest.HostName,
			"guestFullName":      m.Summary.Guest.GuestFullName,
			"toolsRunningStatus": m.Summary.Guest.ToolsRunningStatus,
			"toolsVersionStatus": m.Summary.Guest.ToolsVersionStatus2,
		}
	}
	if m.Summary.Storage != nil {
		st := m.Summary.Storage
		h["storage"] = gin.H{
			"committedBytes":   st.Committed,
			"uncommittedBytes": st.Uncommitted,
			"unsharedBytes":    st.Unshared,
		}
	}
	if m.Guest != nil {
		nets := make([]gin.H, 0, len(m.Guest.Net))
		for _, n := range m.Guest.Net {
			nets = append(nets, gin.H{
				"network": n.Network,
				"mac":     n.MacAddress,
				"ips":     n.IpAddress,
			})
		}
		h["networkInterfaces"] = nets
	}
	h["quickStats"] = quickStatsJSON(m.Summary.QuickStats)
	return h
}

func virtualDisksFromConfig(cfg *types.VirtualMachineConfigInfo) []gin.H {
	out := make([]gin.H, 0)
	for _, dev := range cfg.Hardware.Device {
		d, ok := dev.(*types.VirtualDisk)
		if !ok || d == nil {
			continue
		}
		vd := &d.VirtualDevice
		label := ""
		if vd.DeviceInfo != nil {
			if desc, ok := vd.DeviceInfo.(*types.Description); ok && desc != nil {
				label = desc.Label
			}
		}
		out = append(out, gin.H{
			"key":           vd.Key,
			"label":         label,
			"capacityKB":    d.CapacityInKB,
			"unitNumber":    vd.UnitNumber,
			"controllerKey": vd.ControllerKey,
			"fileName":      diskBackingFileName(vd.Backing),
		})
	}
	return out
}

func diskBackingFileName(b types.BaseVirtualDeviceBackingInfo) string {
	if b == nil {
		return ""
	}
	switch t := b.(type) {
	case *types.VirtualDiskFlatVer2BackingInfo:
		return t.FileName
	case *types.VirtualDiskSparseVer2BackingInfo:
		return t.FileName
	case *types.VirtualDiskFlatVer1BackingInfo:
		return t.FileName
	case *types.VirtualDiskSparseVer1BackingInfo:
		return t.FileName
	case *types.VirtualDiskRawDiskMappingVer1BackingInfo:
		return t.FileName
	case *types.VirtualDiskSeSparseBackingInfo:
		return t.FileName
	default:
		return ""
	}
}

func quickStatsJSON(qs types.VirtualMachineQuickStats) gin.H {
	return gin.H{
		"cpuUsageMHz":        qs.OverallCpuUsage,
		"cpuDemandMHz":       qs.OverallCpuDemand,
		"cpuReadinessPct":    qs.OverallCpuReadiness,
		"guestMemoryUsageMB": qs.GuestMemoryUsage,
		"hostMemoryUsageMB":  qs.HostMemoryUsage,
		"uptimeSeconds":      qs.UptimeSeconds,
		"balloonedMemoryMB":  qs.BalloonedMemory,
		"swappedMemoryMB":    qs.SwappedMemory,
		"grantedMemoryMB":    qs.GrantedMemory,
		"privateMemoryMB":    qs.PrivateMemory,
		"sharedMemoryMB":     qs.SharedMemory,
		"activeMemoryMB":     qs.ActiveMemory,
	}
}

func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func roundPct1(v float64) float64 {
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*10) / 10
}

// hostHardwareDetail 从 HostSystem.hardware 与 summary.hardware 提取物理机信息（厂商、序列号、CPU 插槽、BIOS 等）。
func hostHardwareDetail(m *mo.HostSystem) gin.H {
	if m == nil {
		return nil
	}
	out := gin.H{}
	if m.Hardware != nil {
		h := m.Hardware
		si := h.SystemInfo
		if strings.TrimSpace(si.Vendor) != "" {
			out["vendor"] = strings.TrimSpace(si.Vendor)
		}
		if strings.TrimSpace(si.Model) != "" {
			out["model"] = strings.TrimSpace(si.Model)
		}
		if strings.TrimSpace(si.Uuid) != "" {
			out["uuid"] = strings.TrimSpace(si.Uuid)
		}
		if strings.TrimSpace(si.SerialNumber) != "" {
			out["serialNumber"] = strings.TrimSpace(si.SerialNumber)
		}
		if len(si.OtherIdentifyingInfo) > 0 {
			oids := make([]gin.H, 0, len(si.OtherIdentifyingInfo))
			for _, o := range si.OtherIdentifyingInfo {
				k := ""
				if o.IdentifierType != nil {
					if d := o.IdentifierType.GetElementDescription(); d != nil {
						k = d.Key
					}
				}
				oids = append(oids, gin.H{"identifierType": k, "identifierValue": o.IdentifierValue})
			}
			out["otherIdentifyingInfo"] = oids
		}
		out["cpuPackagesCount"] = h.CpuInfo.NumCpuPackages
		out["cpuCoresPhysical"] = h.CpuInfo.NumCpuCores
		out["cpuThreads"] = h.CpuInfo.NumCpuThreads
		if h.CpuInfo.Hz > 0 {
			out["cpuHzPerCore"] = h.CpuInfo.Hz
		}
		if len(h.CpuPkg) > 0 {
			pkgs := make([]gin.H, 0, len(h.CpuPkg))
			for _, p := range h.CpuPkg {
				pkgs = append(pkgs, gin.H{
					"index":       p.Index,
					"vendor":      p.Vendor,
					"description": p.Description,
					"hz":          p.Hz,
					"busHz":       p.BusHz,
				})
			}
			out["cpuPackages"] = pkgs
		}
		if h.MemorySize > 0 {
			out["memorySizeBytes"] = h.MemorySize
		}
		if h.BiosInfo != nil {
			b := h.BiosInfo
			bj := gin.H{}
			if b.BiosVersion != "" {
				bj["biosVersion"] = b.BiosVersion
			}
			if b.Vendor != "" {
				bj["vendor"] = b.Vendor
			}
			if b.ReleaseDate != nil {
				bj["releaseDate"] = b.ReleaseDate.UTC().Format(time.RFC3339)
			}
			if len(bj) > 0 {
				out["bios"] = bj
			}
		}
	}
	if m.Summary.Hardware != nil {
		sh := m.Summary.Hardware
		if _, ok := out["vendor"]; !ok && strings.TrimSpace(sh.Vendor) != "" {
			out["vendor"] = strings.TrimSpace(sh.Vendor)
		}
		if _, ok := out["model"]; !ok && strings.TrimSpace(sh.Model) != "" {
			out["model"] = strings.TrimSpace(sh.Model)
		}
		if _, ok := out["uuid"]; !ok && strings.TrimSpace(sh.Uuid) != "" {
			out["uuid"] = strings.TrimSpace(sh.Uuid)
		}
		if _, ok := out["otherIdentifyingInfo"]; !ok && len(sh.OtherIdentifyingInfo) > 0 {
			oids := make([]gin.H, 0, len(sh.OtherIdentifyingInfo))
			for _, o := range sh.OtherIdentifyingInfo {
				k := ""
				if o.IdentifierType != nil {
					if d := o.IdentifierType.GetElementDescription(); d != nil {
						k = d.Key
					}
				}
				oids = append(oids, gin.H{"identifierType": k, "identifierValue": o.IdentifierValue})
			}
			out["otherIdentifyingInfo"] = oids
		}
		if _, ok := out["memorySizeBytes"]; !ok && sh.MemorySize > 0 {
			out["memorySizeBytes"] = sh.MemorySize
		}
		if sh.CpuModel != "" {
			out["cpuModelSummary"] = sh.CpuModel
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func hostRowFromMO(m *mo.HostSystem, ref string) gin.H {
	name := strings.TrimSpace(m.Summary.Config.Name)
	if name == "" {
		name = strings.TrimSpace(m.Name)
	}
	if name == "" {
		name = ref
	}
	qs := m.Summary.QuickStats
	var hw *types.HostHardwareSummary
	if m.Summary.Hardware != nil {
		hw = m.Summary.Hardware
	}
	var cpuMHzTotal int64
	var memTotalMB int64
	var numCores int32
	if hw != nil {
		numCores = int32(hw.NumCpuCores)
		cpuMHzTotal = int64(hw.CpuMhz) * int64(hw.NumCpuCores)
		if hw.MemorySize > 0 {
			memTotalMB = hw.MemorySize / (1024 * 1024)
		}
	}
	cpuPct := 0.0
	if cpuMHzTotal > 0 && qs.OverallCpuUsage >= 0 {
		cpuPct = float64(qs.OverallCpuUsage) / float64(cpuMHzTotal) * 100
		if cpuPct > 100 {
			cpuPct = 100
		}
	}
	memPct := 0.0
	if memTotalMB > 0 && qs.OverallMemoryUsage >= 0 {
		memPct = float64(qs.OverallMemoryUsage) / float64(memTotalMB) * 100
		if memPct > 100 {
			memPct = 100
		}
	}
	esxi := ""
	if m.Summary.Config.Product != nil {
		esxi = strings.TrimSpace(m.Summary.Config.Product.FullName)
	}
	row := gin.H{
		"moref":              ref,
		"name":               name,
		"connectionState":    string(m.Runtime.ConnectionState),
		"overallStatus":      string(m.Summary.OverallStatus),
		"cpuCores":           numCores,
		"cpuMhzPerCore":      func() int32 { if hw != nil { return hw.CpuMhz }; return 0 }(),
		"cpuUsageMHz":        qs.OverallCpuUsage,
		"cpuCapacityMHz":     cpuMHzTotal,
		"cpuUsagePercent":    roundPct1(cpuPct),
		"memoryTotalMB":      memTotalMB,
		"memoryUsageMB":      qs.OverallMemoryUsage,
		"memoryUsagePercent": roundPct1(memPct),
		"uptimeSec":          qs.Uptime,
		"esxiVersion":        esxi,
	}
	if hw != nil {
		row["vendor"] = hw.Vendor
		row["model"] = hw.Model
	}
	return row
}

// handleVCenterHostDetail 单个 ESXi 宿主机摘要（与列表项字段一致）。
func handleVCenterHostDetail(c *gin.Context, app *ServerApp) {
	vc := app.VCenter()
	cfg := vc.cfg
	if !cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	moref := strings.TrimSpace(c.Param("moref"))
	if moref == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少宿主机 moref"})
		return
	}
	ctx := c.Request.Context()
	client, err := vc.getClient(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	hs := object.NewHostSystem(client.Client, types.ManagedObjectReference{Type: "HostSystem", Value: moref})
	var m mo.HostSystem
	if err := hs.Properties(ctx, hs.Reference(), []string{"name", "summary", "runtime", "hardware"}, &m); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "宿主机不存在或无权访问: " + err.Error()})
		return
	}
	row := hostRowFromMO(&m, moref)
	if hd := hostHardwareDetail(&m); hd != nil {
		row["hardwareDetail"] = hd
	}
	c.JSON(http.StatusOK, gin.H{"host": row})
}

// handleVCenterHosts 列出 ESXi 宿主机及 QuickStats 资源使用率（CPU/Mem）。
func handleVCenterHosts(c *gin.Context, app *ServerApp) {
	vc := app.VCenter()
	cfg := vc.cfg
	if !cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	ctx := c.Request.Context()
	client, err := vc.getClient(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	f := find.NewFinder(client.Client, true)
	dcs, err := f.DatacenterList(ctx, "*")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "列出数据中心失败: " + err.Error()})
		return
	}
	out := make([]gin.H, 0)
	seen := make(map[string]struct{})
	for _, dc := range dcs {
		f.SetDatacenter(dc)
		hosts, err := f.HostSystemList(ctx, "*")
		if err != nil {
			continue
		}
		for _, hs := range hosts {
			ref := hs.Reference().Value
			if _, ok := seen[ref]; ok {
				continue
			}
			seen[ref] = struct{}{}
			var m mo.HostSystem
			if err := hs.Properties(ctx, hs.Reference(), []string{"name", "summary", "runtime"}, &m); err != nil {
				continue
			}
			out = append(out, hostRowFromMO(&m, ref))
		}
	}
	c.JSON(http.StatusOK, gin.H{"hosts": out})
}

func handleVCenterVMWebmks(c *gin.Context, vc *vCenterClient) {
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
	ticket, err := vm.AcquireTicket(ctx, string(types.VirtualMachineTicketTypeWebmks))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "获取 WebMKS 票据失败: " + err.Error()})
		return
	}
	port := ticket.Port
	if port == 0 {
		port = 443
	}
	host := ticket.Host
	tok := ticket.Ticket
	wss := fmt.Sprintf("wss://%s:%d/ticket/%s", host, port, url.PathEscape(tok))
	c.JSON(http.StatusOK, gin.H{
		"host":          host,
		"port":          port,
		"sslThumbprint": ticket.SslThumbprint,
		"ticket":        tok,
		"cfgFile":       ticket.CfgFile,
		"wssUrl":        wss,
		"proxyPath":     fmt.Sprintf("/api/vcenter/vms/%s/console-ws", url.PathEscape(moref)),
		"hint":          "浏览器通过同源 WebSocket 代理连接 ESXi WebMKS；需运行 kube-bt-sync 的机器能访问 ESXi 主机。",
	})
}

func registerVCenterRoutes(api *gin.RouterGroup, app *ServerApp) {
	api.GET("/vcenter/status", func(c *gin.Context) { handleVCenterStatus(c, app.Cfg()) })
	api.GET("/vcenter/hosts/:moref/metrics", func(c *gin.Context) { handleVCenterHostMetrics(c, app.VCenter()) })
	api.GET("/vcenter/hosts/:moref", func(c *gin.Context) { handleVCenterHostDetail(c, app) })
	api.GET("/vcenter/hosts", func(c *gin.Context) { handleVCenterHosts(c, app) })
	api.GET("/vcenter/vms/perf-snapshot", func(c *gin.Context) { handleVCenterVMsPerfSnapshot(c, app.VCenter()) })
	api.GET("/vcenter/vms", func(c *gin.Context) { handleVCenterVMs(c, app) })
	api.GET("/vcenter/vms/:moref", func(c *gin.Context) { handleVCenterVMDetail(c, app.VCenter()) })
	api.GET("/vcenter/vms/:moref/metrics", func(c *gin.Context) { handleVCenterVMMetrics(c, app.VCenter()) })
	api.GET("/vcenter/vms/:moref/webmks", func(c *gin.Context) { handleVCenterVMWebmks(c, app.VCenter()) })
	api.GET("/vcenter/vms/:moref/console-ws", func(c *gin.Context) { handleVCenterConsoleWS(c, app.VCenter()) })
	api.GET("/vcenter/vms/:moref/console-html", func(c *gin.Context) { handleVCenterVMConsoleHTMLURL(c, app.VCenter(), app.Cfg()) })
	api.GET("/vcenter/vms/:moref/ssh-settings", func(c *gin.Context) { handleGetVCenterVMSSHSettings(c, app.Cfg(), app.SSHStore()) })
	api.PUT("/vcenter/vms/:moref/ssh-settings", func(c *gin.Context) { handlePutVCenterVMSSHSettings(c, app.Cfg(), app.SSHStore()) })
	api.DELETE("/vcenter/vms/:moref/ssh-settings", func(c *gin.Context) { handleDeleteVCenterVMSSHSettings(c, app.Cfg(), app.SSHStore()) })
	api.GET("/vcenter/vms/:moref/ssh/ws", func(c *gin.Context) { handleVCenterVMSSHWS(c, app.VCenter(), app.Cfg(), app.SSHStore()) })
	api.POST("/vcenter/vms/:moref/power", func(c *gin.Context) { handleVCenterVMPower(c, app.VCenter()) })
	api.GET("/vcenter/tasks/:taskId", func(c *gin.Context) { handleVCenterTaskStatus(c, app.VCenter()) })
	api.PUT("/vcenter/vms/:moref/hardware", func(c *gin.Context) { handleVCenterVMHardware(c, app.VCenter()) })
	api.POST("/vcenter/vms/:moref/disk/expand", func(c *gin.Context) { handleVCenterVMDiskExpand(c, app.VCenter()) })
}
