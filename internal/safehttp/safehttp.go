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

// Allowed reports whether ip is a public unicast address.
func Allowed(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsValid() && !ip.IsLoopback() && !ip.IsPrivate() && !ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() && !ip.IsInterfaceLocalMulticast() && !ip.IsMulticast() &&
		!ip.IsUnspecified() && !cgnat.Contains(ip)
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

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
