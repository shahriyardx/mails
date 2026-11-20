// Package addr is the one place that parses and compares email addresses,
// domains and subjects. Every other package goes through it, so a rule such
// as "subdomains are covered by their parent" is written once.
package addr

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"html"
	"net/mail"
	"regexp"
	"strings"
)

// Address is one mailbox in a header. Name is empty when there is none and is
// written to JSON as null, matching the public API.
type Address struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

func (a Address) MarshalJSON() ([]byte, error) {
	var name *string
	if a.Name != "" {
		name = &a.Name
	}
	return json.Marshal(struct {
		Name    *string `json:"name"`
		Address string  `json:"address"`
	}{name, a.Address})
}

// String formats a for a header: "Ada <ada@x.com>" or "ada@x.com".
func (a Address) String() string {
	if a.Name == "" {
		return a.Address
	}
	return (&mail.Address{Name: a.Name, Address: a.Address}).String()
}

// Display is what a person reads: the name, or the address without one.
func (a Address) Display() string {
	if a.Name != "" {
		return a.Name
	}
	return a.Address
}

// Parse reads one address. Addresses are lower-cased.
func Parse(s string) (Address, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Address{}, false
	}
	if a, err := mail.ParseAddress(s); err == nil {
		return Address{Name: strings.TrimSpace(a.Name), Address: strings.ToLower(a.Address)}, true
	}
	// Real mail is not always RFC 5322; accept a bare "x@y" or "Name <x@y>".
	name, address := "", s
	if i, j := strings.LastIndex(s, "<"), strings.LastIndex(s, ">"); i >= 0 && j > i {
		name = strings.Trim(strings.TrimSpace(s[:i]), `"`)
		address = s[i+1 : j]
	}
	address = strings.ToLower(strings.TrimSpace(address))
	if !Valid(address) {
		return Address{}, false
	}
	return Address{Name: strings.TrimSpace(name), Address: address}, true
}

// ParseList reads a header such as "Ada <ada@x.com>, bob@y.com". Entries that
// are not addresses are dropped.
func ParseList(s string) []Address {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	if list, err := mail.ParseAddressList(s); err == nil {
		out := make([]Address, 0, len(list))
		for _, a := range list {
			out = append(out, Address{Name: strings.TrimSpace(a.Name), Address: strings.ToLower(a.Address)})
		}
		return out
	}
	var out []Address
	for _, part := range splitOutsideQuotes(s) {
		if a, ok := Parse(part); ok {
			out = append(out, a)
		}
	}
	return out
}

func splitOutsideQuotes(s string) []string {
	var parts []string
	var b strings.Builder
	quoted, angled := false, false
	for _, r := range s {
		switch {
		case r == '"':
			quoted = !quoted
		case r == '<' && !quoted:
			angled = true
		case r == '>' && !quoted:
			angled = false
		case (r == ',' || r == ';') && !quoted && !angled:
			parts = append(parts, b.String())
			b.Reset()
			continue
		}
		b.WriteRune(r)
	}
	return append(parts, b.String())
}

var emailPattern = regexp.MustCompile(`^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$`)

// Valid reports whether s looks like a bare address (x@y.z).
func Valid(s string) bool { return emailPattern.MatchString(s) }

// Addresses returns just the address part of each entry.
func Addresses(list []Address) []string {
	out := make([]string, len(list))
	for i, a := range list {
		out[i] = a.Address
	}
	return out
}

// DomainOf returns the lower-cased part after the @.
func DomainOf(address string) string {
	if i := strings.LastIndex(address, "@"); i >= 0 {
		return strings.ToLower(address[i+1:])
	}
	return ""
}

// LocalOf returns the part before the @.
func LocalOf(address string) string {
	if i := strings.LastIndex(address, "@"); i >= 0 {
		return address[:i]
	}
	return address
}

var domainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$`)

// NormalizeDomain cleans user input ("https://Example.com/x") to "example.com"
// and reports whether the result is a domain name.
func NormalizeDomain(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(strings.TrimPrefix(s, "https://"), "http://")
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSuffix(s, ".")
	return s, len(s) <= 253 && domainPattern.MatchString(s)
}

// IsUnder reports whether name is parent or a subdomain of it. SES lets a
// subdomain send on its parent's verification.
func IsUnder(name, parent string) bool {
	name, parent = strings.ToLower(name), strings.ToLower(parent)
	return name == parent || strings.HasSuffix(name, "."+parent)
}

// Covering returns the index of the closest domain in names that covers the
// address's domain (itself, else its nearest parent), or -1.
func Covering(address string, names []string) int {
	d := DomainOf(address)
	best := -1
	for i, n := range names {
		if IsUnder(d, n) && (best < 0 || len(n) > len(names[best])) {
			best = i
		}
	}
	return best
}

var replyPrefix = regexp.MustCompile(`(?i)^(\s*(re|fw|fwd|aw|sv|vs|antw)\s*(\[\d+\])?\s*:\s*)+`)

// NormalizeSubject strips a "Re:"/"Fwd:" chain so replies share a thread.
func NormalizeSubject(s string) string { return strings.TrimSpace(replyPrefix.ReplaceAllString(s, "")) }

// ReplySubject is "Re: <subject>" without stacking prefixes.
func ReplySubject(s string) string {
	if b := NormalizeSubject(s); b != "" {
		return "Re: " + b
	}
	return "Re:"
}

// ForwardSubject is "Fwd: <subject>" without stacking prefixes.
func ForwardSubject(s string) string {
	if b := NormalizeSubject(s); b != "" {
		return "Fwd: " + b
	}
	return "Fwd:"
}

var (
	styleOrScript = regexp.MustCompile(`(?is)<(style|script|head)\b.*?</(style|script|head)>`)
	lineBreaks    = regexp.MustCompile(`(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])>`)
	tags          = regexp.MustCompile(`<[^>]*>`)
	spaces        = regexp.MustCompile(`[ \t]+`)
	blankLines    = regexp.MustCompile(`\n{3,}`)
	whitespace    = regexp.MustCompile(`\s+`)
)

// HTMLToText is a rough plain-text rendering, for snippets and search.
func HTMLToText(h string) string {
	h = styleOrScript.ReplaceAllString(h, " ")
	h = lineBreaks.ReplaceAllString(h, "\n")
	h = tags.ReplaceAllString(h, " ")
	h = html.UnescapeString(h)
	h = strings.ReplaceAll(h, " ", " ")
	h = spaces.ReplaceAllString(h, " ")
	return strings.TrimSpace(blankLines.ReplaceAllString(h, "\n\n"))
}

// Snippet is the first 220 characters of the text body, or of the HTML body
// rendered to text, on one line.
func Snippet(text, htmlBody string) string {
	src := text
	if strings.TrimSpace(src) == "" {
		src = HTMLToText(htmlBody)
	}
	src = strings.TrimSpace(whitespace.ReplaceAllString(src, " "))
	if r := []rune(src); len(r) > 220 {
		return string(r[:220])
	}
	return src
}

// TextToHTML escapes text and turns blank lines into paragraphs.
func TextToHTML(text string) string {
	var b strings.Builder
	for _, block := range regexp.MustCompile(`\n{2,}`).Split(text, -1) {
		b.WriteString("<p>")
		b.WriteString(strings.ReplaceAll(html.EscapeString(block), "\n", "<br/>"))
		b.WriteString("</p>")
	}
	return b.String()
}

// Color is a stable muted color for a seed, used for new mailboxes and
// avatars. Low chroma to suit the dark theme.
func Color(seed string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(seed))
	return fmt.Sprintf("oklch(0.62 0.06 %d)", h.Sum32()%360)
}
