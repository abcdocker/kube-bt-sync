package internal

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func handleAppOpenClawImageCatalogGet(c *gin.Context, app *ServerApp) {
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	doc, err := loadOpenClawImageCatalog(app.PlatformKV())
	if err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	opts := BuildOpenClawCatalogOptions(doc)
	mode := openClawCatalogMode(doc)
	outOpts := make([]gin.H, 0, len(opts))
	for _, o := range opts {
		outOpts = append(outOpts, gin.H{"id": o.ID, "label": o.Label, "image": o.Image})
	}
	c.JSON(http.StatusOK, gin.H{
		"mode":    mode,
		"options": outOpts,
		"catalog": doc,
	})
}

type appOpenClawImageCatalogPutBody struct {
	Catalog OpenClawImageCatalogDoc `json:"catalog"`
}

func handleAppOpenClawImageCatalogPut(c *gin.Context, app *ServerApp) {
	if appCloudVMWriteDenied(c) {
		RespondAPIPermissionDenied(c)
		return
	}
	if app.PlatformKV() == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "platform_kv 不可用"})
		return
	}
	var body appOpenClawImageCatalogPutBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d := body.Catalog
	if err := validateOpenClawImageCatalogDoc(d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(d.Repository) == "" {
		d.Repository = "openclaw"
	}
	if err := saveOpenClawImageCatalog(app.PlatformKV(), d); err != nil {
		RespondAPIError500(c, err.Error())
		return
	}
	mirrorPlatformKVIfDualWrite(app)
	opts := BuildOpenClawCatalogOptions(d)
	outOpts := make([]gin.H, 0, len(opts))
	for _, o := range opts {
		outOpts = append(outOpts, gin.H{"id": o.ID, "label": o.Label, "image": o.Image})
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"mode":    openClawCatalogMode(d),
		"options": outOpts,
		"catalog": d,
	})
}

func validateOpenClawImageCatalogDoc(d OpenClawImageCatalogDoc) error {
	if len(d.Entries) > 0 {
		for i, e := range d.Entries {
			if strings.TrimSpace(e.Image) == "" {
				return fmt.Errorf("entries[%d].image 不能为空", i)
			}
		}
		return nil
	}
	base := strings.TrimSpace(d.RegistryBase)
	if base == "" && len(d.Presets) > 0 {
		return fmt.Errorf("使用模板模式时需填写 registryBase")
	}
	for i, p := range d.Presets {
		if strings.TrimSpace(p.Tag) == "" {
			return fmt.Errorf("presets[%d].tag 不能为空", i)
		}
	}
	return nil
}
