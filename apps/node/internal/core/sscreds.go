package core

import (
	"crypto/sha256"
	"encoding/base64"
)

// DeriveSsPassword derives a user's Shadowsocks-2022 per-user PSK (uPSK) from
// their xray UUID. SS2022 keys MUST be base64 of an exact length (16 bytes for
// 2022-blake3-aes-128-gcm, 32 for the other 2022-blake3 ciphers); a raw UUID is
// not a valid key, so we hash it down to the right length.
//
// The panel's subscription generator derives the identical value
// (sha256("<uuid>:ss") -> first keyLen bytes -> standard base64), so the client
// URI and the node's SS config stay in lock-step without adding a DB column -
// same "don't grow the credential surface" approach as TUIC/AnyTLS. Both the
// xray-core SS adapter and the sing-box SS adapter call this, so the engine
// choice never changes the user's key.
func DeriveSsPassword(uuid, method string) string {
	keyLen := 32
	if method == "2022-blake3-aes-128-gcm" {
		keyLen = 16
	}
	sum := sha256.Sum256([]byte(uuid + ":ss"))
	return base64.StdEncoding.EncodeToString(sum[:keyLen])
}
