package xray

import (
	"strings"
	"testing"
)

// A subprotocol this agent does not render is refused, and refused BEFORE it
// is stored. userInboundProtocol falls through to vless for anything it does
// not know, so without the refusal a `socks` inbound would come up as VLESS on
// that port; and stored, it would fail every later render of the core and take
// the inbounds that are fine down with it.
func TestASubprotocolThisAgentDoesNotRenderIsRefusedAndNotStored(t *testing.T) {
	for _, sub := range []string{"shadowsocks-2077", "SOCKS"} {
		t.Run(sub, func(t *testing.T) {
			core := &fakeCore{}
			a, _ := validatingAdapter(t, core)
			if err := a.ApplyInbound(443, inboundWire(t, "aaaaaaaa-1111-4000-8000-000000000001", 443)); err != nil {
				t.Fatalf("the working inbound: %v", err)
			}

			wire := strings.Replace(
				string(inboundWire(t, "bbbbbbbb-2222-4000-8000-000000000002", 1080)),
				`"inboundId"`, `"subprotocol": "`+sub+`", "inboundId"`, 1,
			)
			err := a.ApplyInbound(1080, []byte(wire))
			if err == nil || !strings.Contains(err.Error(), sub) {
				t.Fatalf("want a refusal naming %q, got %v", sub, err)
			}

			// Only the working inbound is left, and the render still succeeds.
			got := renderedInbounds(t, a)
			users := 0
			for _, ib := range got {
				if ib["tag"] != "api-in" {
					users++
					if ib["protocol"] != "vless" {
						t.Errorf("an inbound other than the working vless one was rendered: %v", ib["protocol"])
					}
				}
			}
			if users != 1 {
				t.Fatalf("want exactly the one working inbound rendered, got %d", users)
			}
		})
	}
}

func TestTheSubprotocolsThisAgentRendersStillPass(t *testing.T) {
	for _, sub := range []string{"", "vless", "trojan", "vmess", "socks", "http"} {
		c := InboundConfig{Subprotocol: sub}
		if err := c.validateSubprotocol(); err != nil {
			t.Errorf("%q: %v", sub, err)
		}
	}
}
