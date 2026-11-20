// Package safehttp is an HTTP client for URLs that someone else chose
// (webhook endpoints, push endpoints). It refuses to connect to loopback,
// private, link-local, multicast and unspecified addresses, so such a URL
// cannot be used to reach the server's own network or a cloud metadata
// service. The check runs on the resolved address at connect time, which
// also defeats DNS rebinding.
package safehttp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"syscall"
	"time"
)

// ErrBlocked is returned when a URL resolves to an address that is not
// allowed.
var ErrBlocked = errors.New("address is not reachable from this server: private, loopback or link-local")

// blocked are the IANA special-purpose ranges, plus the IPv6 forms that
// carry an IPv4 address inside them (NAT64, 6to4, Teredo, IPv4-compatible),
// which could smuggle a private IPv4 address past a check.
var blocked = func() []netip.Prefix {
	var out []netip.Prefix
	for _, p := range []string{
		"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
		"192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
		"198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
		"::/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/32", "2001:db8::/32", "2002::/16",
		"fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8",
	} {
		out = append(out, netip.MustParsePrefix(p))
	}
	return out
}()

var globalUnicast6 = netip.MustParsePrefix("2000::/3")

// Allowed reports whether ip is a public unicast address.
func Allowed(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || (ip.Is6() && !globalUnicast6.Contains(ip)) {
		return false
	}
	for _, p := range blocked {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// Client returns a client with the given timeout. allowLocal permits
// loopback, for trying a receiver out on a development machine.
func Client(timeout time.Duration, allowLocal bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip, err := netip.ParseAddr(host)
			if err != nil {
				return err
			}
			if Allowed(ip) || (allowLocal && ip.Unmap().IsLoopback()) {
				return nil
			}
			return fmt.Errorf("%w (%s)", ErrBlocked, ip)
		},
	}
	transport := &http.Transport{
		Proxy:                 nil, // a proxy would connect for us and skip the check
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: timeout,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		// Redirects could lead anywhere; the caller sees the 3xx instead.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// CheckURL validates a URL someone gave us before storing it: https (http
// only to loopback when allowLocal), and a host that does not resolve to
// a blocked address now.
func CheckURL(ctx context.Context, raw string, allowLocal bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return errors.New("not a URL")
	}
	host := u.Hostname()
	local := host == "localhost" || host == "127.0.0.1" || host == "::1"
	if u.Scheme != "https" && !(allowLocal && local && u.Scheme == "http") {
		return errors.New("must be https")
	}
	if local {
		if allowLocal {
			return nil
		}
		return ErrBlocked
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return fmt.Errorf("cannot resolve %s", host)
	}
	for _, ip := range ips {
		if !Allowed(ip) {
			return ErrBlocked
		}
	}
	return nil
}
