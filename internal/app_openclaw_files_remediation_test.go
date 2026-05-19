package internal

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOpenClawApplyBuiltInRemediations_NoChangeWhenAlreadySet(t *testing.T) {
	raw := `{
  "gateway": {
    "controlUi": { "enabled": true, "allowedOrigins": ["https://x.example"] },
    "http": { "endpoints": { "chatCompletions": { "enabled": true } } }
  },
  "tools": {
    "profile": "full",
    "elevated": { "enabled": true, "allowFrom": { "webchat": ["*"] } }
  },
  "agents": {
    "list": [
      {
        "id": "default",
        "tools": {
          "profile": "full",
          "elevated": { "enabled": true, "allowFrom": { "webchat": ["*"] } }
        }
      }
    ]
  },
  "models": {
    "providers": {
      "ollama": {
        "api": "ollama",
        "models": [{ "id": "qwen2.5:14b-16k", "contextWindow": 16384 }]
      }
    }
  }
}`
	out, steps, err := openClawApplyBuiltInRemediations(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 0 {
		t.Fatalf("expected no steps, got %v", steps)
	}
	if out != strings.TrimSpace(raw) {
		t.Fatalf("expected unchanged raw")
	}
}

func TestOpenClawApplyBuiltInRemediations_PatchesBoth(t *testing.T) {
	raw := `{"gateway":{}}`
	out, steps, err := openClawApplyBuiltInRemediations(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 3 {
		t.Fatalf("expected 3 steps, got %d: %v", len(steps), steps)
	}
	var root map[string]interface{}
	if err := json.Unmarshal([]byte(out), &root); err != nil {
		t.Fatal(err)
	}
	tools := root["tools"].(map[string]interface{})
	el := tools["elevated"].(map[string]interface{})
	if el["enabled"] != true {
		t.Fatalf("tools.elevated.enabled: %#v", el["enabled"])
	}
	gw := root["gateway"].(map[string]interface{})
	cui := gw["controlUi"].(map[string]interface{})
	ao := cui["allowedOrigins"].([]interface{})
	if len(ao) != 1 || ao[0] != "*" {
		t.Fatalf("allowedOrigins: %#v", ao)
	}
	httpM := gw["http"].(map[string]interface{})
	eps := httpM["endpoints"].(map[string]interface{})
	cc := eps["chatCompletions"].(map[string]interface{})
	if cc["enabled"] != true {
		t.Fatalf("chatCompletions.enabled: %#v", cc["enabled"])
	}
}

func TestOpenClawApplyBuiltInRemediations_BumpsOllamaContextWhenBelowMin(t *testing.T) {
	raw := `{"gateway":{"controlUi":{"allowedOrigins":["*"]},"http":{"endpoints":{"chatCompletions":{"enabled":true}}}},"models":{"providers":{"ollama":{"api":"ollama","models":[{"id":"qwen2.5:14b-16k","contextWindow":8192}]}}}}`
	out, steps, err := openClawApplyBuiltInRemediations(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 2 {
		t.Fatalf("expected 2 steps, got %d: %v", len(steps), steps)
	}
	var root map[string]interface{}
	if err := json.Unmarshal([]byte(out), &root); err != nil {
		t.Fatal(err)
	}
	provs := root["models"].(map[string]interface{})["providers"].(map[string]interface{})
	oll := provs["ollama"].(map[string]interface{})
	mods := oll["models"].([]interface{})
	m0 := mods[0].(map[string]interface{})
	if m0["contextWindow"].(float64) != 16384 {
		t.Fatalf("contextWindow: %#v", m0["contextWindow"])
	}
}

func TestOpenClawApplyBuiltInRemediations_StripsAgentDefaultsTools(t *testing.T) {
	raw := `{
  "gateway": {
    "controlUi": { "enabled": true, "allowedOrigins": ["*"] },
    "http": { "endpoints": { "chatCompletions": { "enabled": true } } }
  },
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "sandbox": { "mode": "off" },
      "tools": { "profile": "full" }
    }
  }
}`
	out, steps, err := openClawApplyBuiltInRemediations(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 2 {
		t.Fatalf("expected 2 steps, got %d: %v", len(steps), steps)
	}
	var root map[string]interface{}
	if err := json.Unmarshal([]byte(out), &root); err != nil {
		t.Fatal(err)
	}
	defs := root["agents"].(map[string]interface{})["defaults"].(map[string]interface{})
	if _, bad := defs["tools"]; bad {
		t.Fatalf("agents.defaults.tools should be removed, got %#v", defs["tools"])
	}
	rt := root["tools"].(map[string]interface{})
	el := rt["elevated"].(map[string]interface{})
	if el["enabled"] != true {
		t.Fatalf("expected tools.elevated.enabled true, got %#v", el["enabled"])
	}
}
