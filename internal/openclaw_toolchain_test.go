package internal

import (
	"encoding/json"
	"testing"
)

func TestOpenClawMergeElevatedWebchatForK8s(t *testing.T) {
	root := map[string]interface{}{
		"tools": map[string]interface{}{
			"profile": "coding",
		},
		"agents": map[string]interface{}{
			"list": []interface{}{
				map[string]interface{}{
					"id": "default",
					"tools": map[string]interface{}{
						"profile": "coding",
					},
				},
			},
		},
	}
	if !OpenClawMergeElevatedWebchatForK8s(root) {
		t.Fatal("expected changed=true")
	}
	b, err := json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	tools := out["tools"].(map[string]interface{})
	el := tools["elevated"].(map[string]interface{})
	if el["enabled"] != true {
		t.Fatalf("root elevated.enabled: %#v", el["enabled"])
	}
	list := out["agents"].(map[string]interface{})["list"].([]interface{})
	lt := list[0].(map[string]interface{})["tools"].(map[string]interface{})
	le := lt["elevated"].(map[string]interface{})
	if le["enabled"] != true {
		t.Fatalf("list elevated.enabled: %#v", le["enabled"])
	}
	if !OpenClawMergeElevatedWebchatForK8s(out) {
		// idempotent
	} else {
		t.Fatal("second merge should not report changes")
	}
}
