package xray

import (
	"encoding/json"
	"reflect"
	"testing"
)

// A-027 guard: every field of InboundConfig, changed alone, makes the two
// inbounds unequal, except the ones inboundCompareExempt names. A new field is
// in the comparison by itself; a new field of a kind this test cannot change
// fails it, so the test is extended rather than the field forgotten.
func TestInboundEqual_EveryFieldCounts(t *testing.T) {
	base := filledInbound(t)
	typ := reflect.TypeOf(base)
	for i := 0; i < typ.NumField(); i++ {
		name := typ.Field(i).Name
		changed := base
		bump(t, reflect.ValueOf(&changed).Elem().Field(i), name)
		_, exempt := inboundCompareExempt[name]
		if got := inboundEqual(base, changed); got != exempt {
			if exempt {
				t.Errorf("%s is exempt, yet a change to it reads as a change", name)
			} else {
				t.Errorf("%s changed, inboundEqual still says equal", name)
			}
		}
	}
	for name := range inboundCompareExempt {
		if _, ok := typ.FieldByName(name); !ok {
			t.Errorf("exempt field %s is not in InboundConfig", name)
		}
	}
}

// The same for WARP: a changed credential is a changed inbound.
func TestInboundEqual_EveryWarpFieldCounts(t *testing.T) {
	base := filledInbound(t)
	typ := reflect.TypeOf(*base.Warp)
	for i := 0; i < typ.NumField(); i++ {
		name := typ.Field(i).Name
		changed := base
		w := *base.Warp
		changed.Warp = &w
		bump(t, reflect.ValueOf(&w).Elem().Field(i), "Warp."+name)
		if inboundEqual(base, changed) {
			t.Errorf("Warp.%s changed, inboundEqual still says equal", name)
		}
	}
}

// An empty list and no list are one value, as before A-027: the panel may send
// [] where the install-time config has nothing, and that is not a restart.
func TestInboundEqual_EmptyListIsAbsent(t *testing.T) {
	a := InboundConfig{Warp: &WarpConfig{SecretKey: "k"}}
	b := InboundConfig{
		RealityServerNames: []string{},
		RealityShortIDs:    []string{},
		Warp:               &WarpConfig{SecretKey: "k", Address: []string{}, Reserved: []int{}},
	}
	if !inboundEqual(a, b) {
		t.Fatal("[] and nil read as different")
	}
	if !inboundEqual(InboundConfig{}, InboundConfig{}) {
		t.Fatal("zero values read as different")
	}
	if inboundEqual(InboundConfig{}, InboundConfig{Warp: &WarpConfig{}}) {
		t.Fatal("no WARP and an empty WARP read as one")
	}
}

// The path the finding was about: a push that changes only xhttpMode reaches
// the stored inbound instead of being skipped as "no change".
func TestApplyInbound_XhttpModeChangeIsAChange(t *testing.T) {
	a, _ := newTestAdapter(t)
	push := func(mode string) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"realityDest":        "www.cloudflare.com:443",
			"realityServerNames": []string{"www.cloudflare.com"},
			"realityPrivateKey":  "fake-private-key-for-testing",
			"realityShortIds":    []string{"abc123"},
			"network":            "xhttp",
			"xhttpMode":          mode,
		})
		if err := a.ApplyInbound(8443, body); err != nil {
			t.Fatalf("ApplyInbound(%q): %v", mode, err)
		}
	}
	push("packet-up")
	push("stream-one")
	if got := a.cfg.Inbound.XhttpMode; got != "stream-one" {
		t.Fatalf("XhttpMode = %q after the second push, want stream-one", got)
	}
}

// filledInbound sets every field to something non-zero, so a change to any one
// of them is a change from a real value, not from the zero one.
func filledInbound(t *testing.T) InboundConfig {
	t.Helper()
	var c InboundConfig
	v := reflect.ValueOf(&c).Elem()
	for i := 0; i < v.NumField(); i++ {
		bump(t, v.Field(i), v.Type().Field(i).Name)
	}
	w := WarpConfig{}
	wv := reflect.ValueOf(&w).Elem()
	for i := 0; i < wv.NumField(); i++ {
		bump(t, wv.Field(i), "Warp."+wv.Type().Field(i).Name)
	}
	c.Warp = &w
	return c
}

// bump moves one field to a different non-zero value. A slice gets a new
// element rather than a changed one, so the result never aliases the original.
func bump(t *testing.T, f reflect.Value, name string) {
	t.Helper()
	switch f.Kind() {
	case reflect.String:
		f.SetString(f.String() + "x")
	case reflect.Int:
		f.SetInt(f.Int() + 1)
	case reflect.Bool:
		f.SetBool(!f.Bool())
	case reflect.Slice:
		elem := reflect.New(f.Type().Elem()).Elem()
		bump(t, elem, name+"[]")
		grown := reflect.MakeSlice(f.Type(), 0, f.Len()+1)
		grown = reflect.AppendSlice(grown, f)
		f.Set(reflect.Append(grown, elem))
	case reflect.Pointer:
		if f.IsNil() {
			f.Set(reflect.New(f.Type().Elem()))
			return
		}
		f.Set(reflect.Zero(f.Type()))
	default:
		t.Fatalf("%s is a %s, which this test cannot change: teach bump the kind", name, f.Kind())
	}
}
