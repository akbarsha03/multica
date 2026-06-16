package daemon

import "testing"

// The daemon must refuse all CLI self-update when MULTICA_DAEMON_NO_SELF_UPDATE
// is set — this is what keeps a self-hosted fork's binary from being replaced
// by an upstream GitHub release (the bug where a UI "Update" click wiped a
// custom build).
func TestSelfUpdateDisabled(t *testing.T) {
	cases := []struct {
		val  string
		want bool
	}{
		{"true", true}, {"1", true}, {"yes", true}, {"ON", true}, {" True ", true},
		{"", false}, {"false", false}, {"0", false}, {"no", false},
	}
	for _, c := range cases {
		t.Setenv("MULTICA_DAEMON_NO_SELF_UPDATE", c.val)
		if got := selfUpdateDisabled(); got != c.want {
			t.Fatalf("MULTICA_DAEMON_NO_SELF_UPDATE=%q: got %v, want %v", c.val, got, c.want)
		}
	}
}
