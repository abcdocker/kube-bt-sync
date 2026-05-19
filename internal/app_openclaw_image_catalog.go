package internal

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const kvKeyOpenClawImageCatalog = "kubebt_openclaw_image_catalog_v1"

// OpenClawImageCatalogDoc 平台 OpenClaw 网关镜像目录（存 platform_kv）。
// 二选一生效：① entries 非空时为「显式列表」；② 否则用 registryBase + repository + presets 拼成 {base}/{repo}:{tag}。
type OpenClawImageCatalogDoc struct {
	Entries []OpenClawImageCatalogEntry `json:"entries"`
	// 模板模式（entries 为空时使用）
	RegistryBase string                   `json:"registryBase"`
	Repository   string                   `json:"repository"`
	Presets      []OpenClawImagePresetRow `json:"presets"`
}

type OpenClawImageCatalogEntry struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Image string `json:"image"`
}

type OpenClawImagePresetRow struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Tag   string `json:"tag"`
}

// OpenClawCatalogOption 下发给前端的扁平选项（下拉框）。
type OpenClawCatalogOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Image string `json:"image"`
}

func loadOpenClawImageCatalog(kv PlatformKV) (OpenClawImageCatalogDoc, error) {
	var zero OpenClawImageCatalogDoc
	if kv == nil {
		return zero, errors.New("platform_kv 不可用")
	}
	raw, ok := kv.Get(kvKeyOpenClawImageCatalog)
	if !ok || strings.TrimSpace(raw) == "" {
		return zero, nil
	}
	var d OpenClawImageCatalogDoc
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		return zero, err
	}
	return d, nil
}

func saveOpenClawImageCatalog(kv PlatformKV, d OpenClawImageCatalogDoc) error {
	if kv == nil {
		return errors.New("platform_kv 不可用")
	}
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return kv.Set(kvKeyOpenClawImageCatalog, string(b))
}

func openClawCatalogMode(d OpenClawImageCatalogDoc) string {
	if len(d.Entries) > 0 {
		return "entries"
	}
	if strings.TrimSpace(d.RegistryBase) != "" && len(d.Presets) > 0 {
		for _, p := range d.Presets {
			if strings.TrimSpace(p.Tag) != "" {
				return "template"
			}
		}
	}
	return "none"
}

// BuildOpenClawCatalogOptions 生成下拉选项（显式列表优先）。
func BuildOpenClawCatalogOptions(d OpenClawImageCatalogDoc) []OpenClawCatalogOption {
	if len(d.Entries) > 0 {
		out := make([]OpenClawCatalogOption, 0, len(d.Entries))
		seen := map[string]struct{}{}
		for i, e := range d.Entries {
			img := strings.TrimSpace(e.Image)
			if img == "" {
				continue
			}
			id := strings.TrimSpace(e.ID)
			if id == "" {
				id = fmt.Sprintf("entry-%d", i)
			}
			if _, ok := seen[id]; ok {
				id = fmt.Sprintf("%s-%d", id, i)
			}
			seen[id] = struct{}{}
			lbl := strings.TrimSpace(e.Label)
			if lbl == "" {
				lbl = id
			}
			out = append(out, OpenClawCatalogOption{ID: id, Label: lbl, Image: img})
		}
		return out
	}
	base := strings.Trim(strings.TrimSpace(d.RegistryBase), "/")
	repo := strings.Trim(strings.TrimSpace(d.Repository), "/")
	if base == "" {
		repo = ""
	}
	if repo == "" {
		repo = "openclaw"
	}
	if base == "" {
		return nil
	}
	out := make([]OpenClawCatalogOption, 0, len(d.Presets))
	seen := map[string]struct{}{}
	for i, p := range d.Presets {
		tag := strings.TrimSpace(p.Tag)
		if tag == "" {
			continue
		}
		id := strings.TrimSpace(p.ID)
		if id == "" {
			id = tag
		}
		if _, ok := seen[id]; ok {
			id = fmt.Sprintf("%s-%d", id, i)
		}
		seen[id] = struct{}{}
		lbl := strings.TrimSpace(p.Label)
		if lbl == "" {
			lbl = id + " · " + tag
		}
		img := base + "/" + repo + ":" + tag
		out = append(out, OpenClawCatalogOption{ID: id, Label: lbl, Image: img})
	}
	return out
}
