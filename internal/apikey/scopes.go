package apikey

import "slices"

// Scopes are what kinds of call a key may make.
var Scopes = []string{
	"emails:send", "emails:read",
	"mail:read", "mail:write",
	"mailboxes:read", "mailboxes:write",
	"domains:read", "domains:write",
	"labels:read", "labels:write",
	"contacts:read",
	"suppressions:read", "suppressions:write",
	"webhooks:read", "webhooks:write",
	"stats:read",
}

// Wildcard grants every scope, including ones added later.
const Wildcard = "*"

// Writing implies reading: a key that may change something may see it.
var implies = map[string]string{
	"emails:send": "emails:read", "mail:write": "mail:read", "mailboxes:write": "mailboxes:read",
	"domains:write": "domains:read", "labels:write": "labels:read",
	"suppressions:write": "suppressions:read", "webhooks:write": "webhooks:read",
}

// Valid reports whether s is a scope or the wildcard.
func Valid(s string) bool { return s == Wildcard || slices.Contains(Scopes, s) }

// Has reports whether granted (as stored) allows needed.
func Has(granted []string, needed string) bool {
	for _, g := range granted {
		if g == Wildcard || g == needed || implies[g] == needed {
			return true
		}
	}
	return false
}

// Preset is a named set of scopes offered when making a key.
type Preset struct {
	ID     string   `json:"id"`
	Label  string   `json:"label"`
	Hint   string   `json:"hint"`
	Scopes []string `json:"scopes"`
}

var Presets = []Preset{
	{"full", "Full access", "Everything this instance's API can do.", []string{Wildcard}},
	{"send", "Send only", "Send mail and check what happened to it. Cannot read your inbox.", []string{"emails:send", "emails:read"}},
	{"read", "Read only", "Read mail, mailboxes, domains and stats. Cannot send or change anything.",
		[]string{"emails:read", "mail:read", "mailboxes:read", "domains:read", "labels:read", "contacts:read", "suppressions:read", "webhooks:read", "stats:read"}},
	{"inbox", "Inbox agent", "Read and organise mail, and reply to it. Cannot manage domains or keys.",
		[]string{"emails:send", "emails:read", "mail:read", "mail:write", "mailboxes:read", "labels:read", "labels:write", "contacts:read", "stats:read"}},
}

// Area is one row of the custom scope picker.
type Area struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Hint   string  `json:"hint"`
	Levels []Level `json:"levels"`
}

// Level is one choice in an area.
type Level struct {
	Label  string   `json:"label"`
	Scopes []string `json:"scopes"`
}

func area(id, label, hint, read, write, writeLabel string) Area {
	a := Area{ID: id, Label: label, Hint: hint, Levels: []Level{{"None", []string{}}, {"Read", []string{read}}}}
	if write != "" {
		a.Levels = append(a.Levels, Level{writeLabel, []string{read, write}})
	}
	return a
}

var Areas = []Area{
	area("sending", "Sending", "Send mail, and see what happened to it", "emails:read", "emails:send", "Send"),
	area("mail", "Mail", "Threads, messages, attachments", "mail:read", "mail:write", "Manage"),
	area("mailboxes", "Mailboxes", "The addresses on your domains", "mailboxes:read", "mailboxes:write", "Manage"),
	area("domains", "Domains", "Sending domains and their DNS", "domains:read", "domains:write", "Manage"),
	area("labels", "Labels", "Labels threads are filed under", "labels:read", "labels:write", "Manage"),
	area("contacts", "Contacts", "Everyone mail came from or went to", "contacts:read", "", ""),
	area("suppressions", "Blocked addresses", "Addresses that bounced or complained", "suppressions:read", "suppressions:write", "Manage"),
	area("webhooks", "Webhooks", "Endpoints and their deliveries", "webhooks:read", "webhooks:write", "Manage"),
	area("stats", "Statistics", "Sending and receiving numbers", "stats:read", "", ""),
}
