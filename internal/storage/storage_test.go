package storage

import "testing"

func TestDisposition(t *testing.T) {
	tests := map[string]string{
		"report.pdf":           `attachment; filename="report.pdf"`,
		"a\"b\\c\r\nX-Evil: 1": `attachment; filename="abcX-Evil: 1"`,
		"résumé.pdf":           `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
	}
	for in, want := range tests {
		if got := Disposition("attachment", in); got != want {
			t.Errorf("Disposition(%q) = %q, want %q", in, got, want)
		}
	}
}
