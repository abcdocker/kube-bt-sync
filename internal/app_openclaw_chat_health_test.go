package internal

import (
	"testing"
)

func TestOpenClawHealthPingModelCandidates(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", []string{defaultOpenClawFallbackChatModelID, "gpt-4o-mini", "gpt-3.5-turbo"}},
		{"MiniMax-M2.7", []string{"MiniMax-M2.7", "gpt-4o-mini", "gpt-3.5-turbo"}},
		{"gpt-4o-mini", []string{"gpt-4o-mini", "gpt-3.5-turbo"}},
		{"GPT-4O-MINI", []string{"GPT-4O-MINI", "gpt-3.5-turbo"}}, // 与 gpt-4o-mini 去重，不再重复插入
	}
	for _, tc := range cases {
		got := openClawHealthPingModelCandidates(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("openClawHealthPingModelCandidates(%q) len %d, want %d: %v", tc.in, len(got), len(tc.want), got)
		}
		for i := range tc.want {
			if got[i] != tc.want[i] {
				t.Errorf("openClawHealthPingModelCandidates(%q)[%d]=%q want %q (full %v)", tc.in, i, got[i], tc.want[i], got)
			}
		}
	}
}
