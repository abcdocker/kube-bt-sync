package internal

import (
	"reflect"
	"testing"
)

func TestShouldUseOpenClawGatewayHTTPContract(t *testing.T) {
	if !shouldUseOpenClawGatewayHTTPContract("http://openclaw-gateway.kube-bt.svc.cluster.local:18789/v1") {
		t.Fatal("expected true for cluster svc + 18789")
	}
	if !shouldUseOpenClawGatewayHTTPContract("http://openclaw-gateway.kube-bt.svc.cluster.local/v1") {
		t.Fatal("expected true for openclaw hostname on default port")
	}
	if shouldUseOpenClawGatewayHTTPContract("https://api.openai.com/v1") {
		t.Fatal("expected false for OpenAI")
	}
	if shouldUseOpenClawGatewayHTTPContract("http://node:30123/v1") {
		t.Fatal("expected false for arbitrary NodePort without svc.cluster.local")
	}
	if shouldUseOpenClawGatewayHTTPContract("http://ollama.default.svc.cluster.local:11434/v1") {
		t.Fatal("expected false for non-openclaw in-cluster ollama")
	}
}

func TestOpenClawApplyGatewayModelRouting(t *testing.T) {
	bm, xo := openClawApplyGatewayModelRouting("MiniMax-M2.5")
	if bm != "openclaw/default" || xo != "openai/MiniMax-M2.5" {
		t.Fatalf("got model=%q xo=%q", bm, xo)
	}
	bm, xo = openClawApplyGatewayModelRouting("openclaw/default")
	if bm != "openclaw/default" || xo != "" {
		t.Fatalf("passthrough: model=%q xo=%q", bm, xo)
	}
	bm, xo = openClawApplyGatewayModelRouting("")
	if bm != "openclaw/default" || xo != "" {
		t.Fatalf("empty: model=%q xo=%q", bm, xo)
	}
	bm, xo = openClawApplyGatewayModelRouting("gpt-4o-mini")
	if bm != "openclaw/default" || xo != "openai/gpt-4o-mini" {
		t.Fatalf("gpt: model=%q xo=%q", bm, xo)
	}
	bm, xo = openClawApplyGatewayModelRouting("claude-sonnet-4-20250514")
	if bm != "openclaw/default" || xo != "anthropic/claude-sonnet-4-20250514" {
		t.Fatalf("claude: model=%q xo=%q", bm, xo)
	}
	bm, xo = openClawApplyGatewayModelRouting("openai/custom-id")
	if bm != "openclaw/default" || xo != "openai/custom-id" {
		t.Fatalf("already qualified: model=%q xo=%q", bm, xo)
	}
}

func TestOpenClawGatewayRoutingCandidates(t *testing.T) {
	got := openClawGatewayRoutingCandidates("MiniMax-M2.5")
	want := []openClawGatewayRoutingCandidate{
		{bodyModel: "openclaw/default", headerModel: "openai/MiniMax-M2.5"},
		{bodyModel: "openclaw/default", headerModel: "MiniMax-M2.5"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v want %#v", got, want)
	}
}

func TestOpenClawChatCompletionsURLCandidates(t *testing.T) {
	gw := "http://openclaw-gateway.kube-bt.svc.cluster.local:18789"
	got := openClawChatCompletionsURLCandidates(gw)
	want := []string{
		gw + "/v1/chat/completions",
		gw + "/chat/completions",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("gateway without /v1: got %#v want %#v", got, want)
	}

	gwV1 := gw + "/v1"
	got2 := openClawChatCompletionsURLCandidates(gwV1)
	want2 := []string{
		gwV1 + "/chat/completions",
		gw + "/chat/completions",
	}
	if !reflect.DeepEqual(got2, want2) {
		t.Fatalf("gateway with /v1: got %#v want %#v", got2, want2)
	}

	// 非集群 OpenClaw：仅主 URL，不追加根路径候选
	ext := "https://api.openai.com/v1"
	if g := openClawChatCompletionsURLCandidates(ext); len(g) != 1 || g[0] != ext+"/chat/completions" {
		t.Fatalf("openai: got %#v", g)
	}
}
