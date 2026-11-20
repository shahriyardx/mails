package ses

import (
	"errors"
	"strings"
	"testing"
)

func TestExplain(t *testing.T) {
	for raw, want := range map[string]string{
		"get credentials: failed to refresh cached credentials, no EC2 IMDS role found": "AWS keys are not set",
		"api error InvalidClientTokenId: The security token included in the request is invalid": "AWS refused the keys",
		"User: x is not authorized to perform: sns:CreateTopic": "not allowed",
		"something else": "something else",
	} {
		if got := Explain(errors.New(raw)); !strings.Contains(got, want) {
			t.Errorf("Explain(%q) = %q", raw, got)
		}
	}
}
