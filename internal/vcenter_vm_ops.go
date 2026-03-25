package internal

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/vmware/govmomi/object"
	"github.com/vmware/govmomi/vim25/mo"
	"github.com/vmware/govmomi/vim25/types"
)

func getVCenterVMObject(c *gin.Context, vc *vCenterClient) (*object.VirtualMachine, context.Context, error) {
	if !vc.cfg.vCenterConfigured() {
		return nil, nil, fmt.Errorf("vCenter 未配置")
	}
	moref := strings.TrimSpace(c.Param("moref"))
	if moref == "" {
		return nil, nil, fmt.Errorf("缺少 moref")
	}
	ctx := c.Request.Context()
	client, err := vc.getClient(ctx)
	if err != nil {
		return nil, nil, err
	}
	vm := object.NewVirtualMachine(client.Client, types.ManagedObjectReference{Type: "VirtualMachine", Value: moref})
	return vm, ctx, nil
}

func handleVCenterVMPower(c *gin.Context, vc *vCenterClient) {
	vm, ctx, err := getVCenterVMObject(c, vc)
	if err != nil {
		if err.Error() == "vCenter 未配置" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体须为 JSON，且包含 action"})
		return
	}
	action := strings.ToLower(strings.TrimSpace(body.Action))
	if action == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action 不能为空"})
		return
	}
	tpl, err := vm.IsTemplate(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if tpl {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模板虚拟机不能执行电源操作"})
		return
	}

	var run func(context.Context) (*object.Task, error)
	var guestOnly string

	switch action {
	case "on", "poweron", "power-on", "start":
		run = vm.PowerOn
	case "off", "poweroff", "power-off", "stop":
		run = vm.PowerOff
	case "suspend":
		run = vm.Suspend
	case "reset":
		run = vm.Reset
	case "shutdown_guest", "shutdown-guest", "shutdownguest", "guest_shutdown":
		guestOnly = "shutdownGuest"
	case "reboot_guest", "reboot-guest", "rebootguest", "guest_reboot":
		guestOnly = "rebootGuest"
	case "standby_guest", "standby-guest", "standbyguest":
		guestOnly = "standbyGuest"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知 action，支持: on, off, suspend, reset, shutdown_guest, reboot_guest, standby_guest"})
		return
	}

	if guestOnly != "" {
		switch guestOnly {
		case "shutdownGuest":
			err = vm.ShutdownGuest(ctx)
		case "rebootGuest":
			err = vm.RebootGuest(ctx)
		case "standbyGuest":
			err = vm.StandbyGuest(ctx)
		}
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "action": guestOnly})
		return
	}

	task, err := run(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":     true,
		"action": action,
		"taskId": task.Reference().Value,
	})
}

func handleVCenterTaskStatus(c *gin.Context, vc *vCenterClient) {
	if !vc.cfg.vCenterConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "vCenter 未配置"})
		return
	}
	taskID := strings.TrimSpace(c.Param("taskId"))
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 taskId"})
		return
	}
	ctx := c.Request.Context()
	client, err := vc.getClient(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	ref := types.ManagedObjectReference{Type: "Task", Value: taskID}
	t := object.NewTask(client.Client, ref)
	var m mo.Task
	if err := t.Properties(ctx, t.Reference(), []string{"info"}, &m); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在或已过期: " + err.Error()})
		return
	}
	info := m.Info
	out := gin.H{
		"state":    string(info.State),
		"progress": info.Progress,
	}
	if info.Description != nil {
		out["description"] = info.Description.Message
	}
	if info.State == types.TaskInfoStateError && info.Error != nil {
		msg := strings.TrimSpace(info.Error.LocalizedMessage)
		if msg == "" {
			msg = fmt.Sprintf("%v", info.Error.Fault)
		}
		out["error"] = msg
	}
	c.JSON(http.StatusOK, out)
}

func handleVCenterVMHardware(c *gin.Context, vc *vCenterClient) {
	vm, ctx, err := getVCenterVMObject(c, vc)
	if err != nil {
		if err.Error() == "vCenter 未配置" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var body struct {
		NumCPU   *int32 `json:"numCpu"`
		MemoryMB *int64 `json:"memoryMB"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体须为 JSON"})
		return
	}
	tpl, err := vm.IsTemplate(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if tpl {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模板虚拟机不能修改硬件"})
		return
	}
	if body.NumCPU == nil && body.MemoryMB == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "至少指定 numCpu 或 memoryMB（正整数）"})
		return
	}

	spec := types.VirtualMachineConfigSpec{}
	if body.NumCPU != nil {
		if *body.NumCPU < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "numCpu 须 >= 1"})
			return
		}
		spec.NumCPUs = *body.NumCPU
	}
	if body.MemoryMB != nil {
		if *body.MemoryMB < 4 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "memoryMB 须 >= 4"})
			return
		}
		spec.MemoryMB = *body.MemoryMB
	}

	task, err := vm.Reconfigure(ctx, spec)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err := task.Wait(ctx); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func handleVCenterVMDiskExpand(c *gin.Context, vc *vCenterClient) {
	vm, ctx, err := getVCenterVMObject(c, vc)
	if err != nil {
		if err.Error() == "vCenter 未配置" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var body struct {
		DeviceKey  int32   `json:"deviceKey"`
		TotalGiB   float64 `json:"totalGiB"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求体须为 JSON，包含 deviceKey 与 totalGiB"})
		return
	}
	if body.DeviceKey == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceKey 无效"})
		return
	}
	if body.TotalGiB <= 0 || math.IsNaN(body.TotalGiB) || math.IsInf(body.TotalGiB, 0) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "totalGiB 须为大于 0 的数（目标总容量，GiB）"})
		return
	}

	tpl, err := vm.IsTemplate(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if tpl {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模板虚拟机不能扩容磁盘"})
		return
	}

	devices, err := vm.Device(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	raw := devices.FindByKey(body.DeviceKey)
	if raw == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "未找到该 deviceKey 对应设备"})
		return
	}
	disk, ok := raw.(*types.VirtualDisk)
	if !ok || disk == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该设备不是虚拟磁盘"})
		return
	}

	newKB := int64(math.Round(body.TotalGiB * 1024 * 1024))
	if disk.CapacityInKB >= newKB {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("新容量须大于当前值（当前约 %.2f GiB）", float64(disk.CapacityInKB)/(1024*1024))})
		return
	}

	newDisk := *disk
	newDisk.CapacityInKB = newKB
	if newKB > 0 {
		newDisk.CapacityInBytes = newKB * 1024
	}

	spec := types.VirtualMachineConfigSpec{
		DeviceChange: []types.BaseVirtualDeviceConfigSpec{
			&types.VirtualDeviceConfigSpec{
				Operation: types.VirtualDeviceConfigSpecOperationEdit,
				Device:    &newDisk,
			},
		},
	}

	task, err := vm.Reconfigure(ctx, spec)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err := task.Wait(ctx); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "capacityKB": newKB})
}
