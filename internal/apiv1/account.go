package apiv1

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/webhook"
)

// ---- Mailboxes --------------------------------------------------------------

func (a *API) listMailboxes(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	all, err := a.Mailboxes.List(r.Context(), r.URL.Query().Get("domain"))
	if err != nil {
		return 0, nil, err
	}
	out := []*mailbox.Mailbox{}
	for _, m := range all {
		if within(allowed, m.ID) {
			out = append(out, m)
		}
	}
	return 200, page.Of(out), nil
}

func (a *API) getMailbox(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	id, err := a.mailboxInReach(r.Context(), c, chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	m, err := a.Mailboxes.Get(r.Context(), id)
	return 200, m, err
}

// mayShape guards the mailbox flags that reach past one mailbox: the
// default is account-wide, and a catch-all receives mail for every unknown
// address on its domain. Only a key that holds the whole domain may set
// catch-all, and only an unrestricted key may move the default.
func (a *API) mayShape(r *http.Request, c *caller, address string, catchAll, setDefault bool) error {
	if c.key.Reach.Unrestricted() {
		return nil
	}
	if setDefault {
		return httpx.Forbidden("Only a key that reaches the whole account may change the default mailbox")
	}
	if catchAll {
		covers, err := apikey.CoversDomainOf(r.Context(), a.DB, c.key.Reach, address)
		if err != nil {
			return err
		}
		if !covers {
			return httpx.Forbidden("Only a key that holds the whole domain may make a catch-all")
		}
	}
	return nil
}

func (a *API) createMailbox(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in mailbox.Input
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	if err := a.mayShape(r, c, in.Address, in.IsCatchAll, in.IsDefault); err != nil {
		return 0, nil, err
	}
	// A key that names addresses holds exactly those; a domain key may add
	// to its domains.
	if !c.key.Reach.Unrestricted() {
		covers, err := apikey.CoversDomainOf(r.Context(), a.DB, c.key.Reach, in.Address)
		if err != nil {
			return 0, nil, err
		}
		if !covers {
			return 0, nil, httpx.Forbidden("This API key cannot add mailboxes there")
		}
	}
	m, err := a.Mailboxes.Create(r.Context(), in)
	return 201, m, err
}

func (a *API) patchMailbox(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var p mailbox.Patch
	if err := httpx.Decode(r, &p); err != nil {
		return 0, nil, err
	}
	id, err := a.mailboxInReach(r.Context(), c, chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	current, err := a.Mailboxes.Get(r.Context(), id)
	if err != nil {
		return 0, nil, err
	}
	if err := a.mayShape(r, c, current.Address, p.IsCatchAll.Set && p.IsCatchAll.Value, p.IsDefault.Set); err != nil {
		return 0, nil, err
	}
	m, err := a.Mailboxes.Update(r.Context(), id, p)
	return 200, m, err
}

func (a *API) deleteMailbox(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	id, err := a.mailboxInReach(r.Context(), c, chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	m, err := a.Mailboxes.Delete(r.Context(), id, boolQuery(r, "confirm"))
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"object": "mailbox", "id": m.ID, "deleted": true}, nil
}

// ---- Domains ----------------------------------------------------------------

// domainsInReach returns the domain ids a restricted key may see: its
// domains, and the domains of its mailboxes. nil means all.
func (a *API) domainsInReach(r *http.Request, c *caller) ([]string, error) {
	if c.key.Reach.Unrestricted() {
		return nil, nil
	}
	ids := slices.Clone(c.key.Reach.DomainIDs)
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB.Query(r.Context(), `SELECT DISTINCT domain_id FROM mailbox WHERE id = ANY($1) AND domain_id IS NOT NULL`, allowed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, rows.Err()
}

func (a *API) listDomains(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	seen, err := a.domainsInReach(r, c)
	if err != nil {
		return 0, nil, err
	}
	all, err := a.Domains.List(r.Context())
	if err != nil {
		return 0, nil, err
	}
	out := []*domain.Domain{}
	for _, d := range all {
		if within(seen, d.ID) {
			out = append(out, d)
		}
	}
	return 200, page.Of(out), nil
}

func (a *API) domainInReach(r *http.Request, c *caller) (*domain.Domain, error) {
	d, err := a.Domains.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return nil, err
	}
	seen, err := a.domainsInReach(r, c)
	if err != nil {
		return nil, err
	}
	if !within(seen, d.ID) {
		return nil, httpx.NotFound("No such domain")
	}
	return d, nil
}

func (a *API) getDomain(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	d, err := a.domainInReach(r, c)
	return 200, d, err
}

func (a *API) addDomain(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "add a domain"); err != nil {
		return 0, nil, err
	}
	var in struct {
		Name string `json:"name" validate:"required"`
	}
	if err := httpx.Bind(r, &in); err != nil {
		return 0, nil, err
	}
	d, err := a.Domains.Add(r.Context(), in.Name)
	return 201, d, err
}

func (a *API) verifyDomain(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	d, err := a.domainInReach(r, c)
	if err != nil {
		return 0, nil, err
	}
	// Seeing a domain through one of its mailboxes is not holding it.
	if !c.key.Reach.Unrestricted() && !slices.Contains(c.key.Reach.DomainIDs, d.ID) {
		return 0, nil, httpx.Forbidden("This API key does not hold that domain")
	}
	d, err = a.Domains.Refresh(r.Context(), d.ID)
	return 200, d, err
}

func (a *API) deleteDomain(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "remove a domain"); err != nil {
		return 0, nil, err
	}
	d, inSES, err := a.Domains.Remove(r.Context(), chi.URLParam(r, "id"), boolQuery(r, "delete_in_ses"))
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"object": "domain", "id": d.ID, "name": d.Name, "deleted": true, "deleted_in_ses": inSES}, nil
}

// ---- Labels and contacts ----------------------------------------------------

func (a *API) listLabels(_ http.ResponseWriter, r *http.Request, _ *caller) (int, any, error) {
	list, err := a.Mail.ListLabels(r.Context())
	return 200, page.Of(list), err
}

func (a *API) getLabel(_ http.ResponseWriter, r *http.Request, _ *caller) (int, any, error) {
	l, err := a.Mail.GetLabel(r.Context(), chi.URLParam(r, "id"))
	return 200, l, err
}

func (a *API) createLabel(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "create a label: labels are shared by the whole account"); err != nil {
		return 0, nil, err
	}
	var in mail.LabelInput
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	l, err := a.Mail.CreateLabel(r.Context(), in)
	return 201, l, err
}

func (a *API) patchLabel(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "change a label: labels are shared by the whole account"); err != nil {
		return 0, nil, err
	}
	var in mail.LabelInput
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	l, err := a.Mail.UpdateLabel(r.Context(), chi.URLParam(r, "id"), in)
	return 200, l, err
}

func (a *API) deleteLabel(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "delete a label: labels are shared by the whole account"); err != nil {
		return 0, nil, err
	}
	l, err := a.Mail.DeleteLabel(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"object": "label", "id": l.ID, "deleted": true}, nil
}

func (a *API) listContacts(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "read contacts: they are kept for the whole account"); err != nil {
		return 0, nil, err
	}
	p, err := page.Parse(r.URL.Query())
	if err != nil {
		return 0, nil, err
	}
	list, err := a.Mail.ListContacts(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("order"), p)
	return 200, list, err
}

// ---- Suppressions -----------------------------------------------------------

// The blocked list is kept for the whole account, like contacts: reading
// or emptying it is not for a key that reaches only part of it. Adding to
// it only ever stops mail, so any key with the scope may.
func (a *API) listSuppressions(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "read the blocked list: it is kept for the whole account"); err != nil {
		return 0, nil, err
	}
	p, err := page.Parse(r.URL.Query())
	if err != nil {
		return 0, nil, err
	}
	list, err := a.Delivery.ListSuppressions(r.Context(), r.URL.Query().Get("q"), p)
	return 200, list, err
}

// addSuppression is 201 when new and 200 when already blocked: blocking an
// address that is blocked is the state asked for, not an error. A key that
// may not read the blocked list gets the same 200 reply either way, so it
// cannot use this call to learn whether an address was on it.
func (a *API) addSuppression(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in struct {
		Address string `json:"address" validate:"required"`
		Reason  string `json:"reason" validate:"max=200"`
	}
	if err := httpx.Bind(r, &in); err != nil {
		return 0, nil, err
	}
	x, err := a.Delivery.Suppress(r.Context(), in.Address, in.Reason)
	var he *httpx.Error
	if !c.key.Reach.Unrestricted() && (err == nil || errors.As(err, &he) && he.Status == 409) {
		return 200, map[string]any{"object": "suppression", "address": strings.ToLower(strings.TrimSpace(in.Address)), "blocked": true}, nil
	}
	if errors.As(err, &he) && he.Status == 409 {
		list, err := a.Delivery.ListSuppressions(r.Context(), in.Address, page.Params{Limit: 1})
		if err != nil || len(list.Data) == 0 {
			return 0, nil, err
		}
		return 200, list.Data[0], nil
	}
	return 201, x, err
}

func (a *API) deleteSuppression(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	if err := unrestricted(c, "unblock an address: the blocked list is kept for the whole account"); err != nil {
		return 0, nil, err
	}
	x, err := a.Delivery.Unsuppress(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{"object": "suppression", "id": x.ID, "address": x.Address, "deleted": true}, nil
}

// ---- Webhooks ---------------------------------------------------------------

// visibleHooks is what endpoints a key sees: those on a mailbox it reaches
// or on a domain it holds. nil (unrestricted) sees all.
func (a *API) visibleHooks(r *http.Request, c *caller) (*webhook.Scope, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil || allowed == nil {
		return nil, err
	}
	return &webhook.Scope{MailboxIDs: allowed, DomainIDs: c.key.Reach.DomainIDs}, nil
}

// mayWatch enforces reach on a webhook's scope: an unscoped or domain-wide
// endpoint hears mail a restricted key might not read.
func (a *API) mayWatch(r *http.Request, c *caller, mailboxID, domainID *string) error {
	if c.key.Reach.Unrestricted() {
		return nil
	}
	switch {
	case mailboxID != nil:
		_, err := a.mailboxInReach(r.Context(), c, *mailboxID)
		return err
	case domainID != nil && slices.Contains(c.key.Reach.DomainIDs, *domainID):
		return nil
	case domainID != nil:
		return httpx.Forbidden("This API key does not reach that domain")
	default:
		return httpx.Forbidden("This API key reaches only part of the account, so a webhook on it must name a mailbox or one of its domains")
	}
}

func (a *API) listWebhooks(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	list, err := a.Webhooks.List(r.Context(), visible)
	return 200, page.Of(list), err
}

func (a *API) getWebhook(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	w, err := a.Webhooks.Get(r.Context(), visible, chi.URLParam(r, "id"))
	return 200, w, err
}

func (a *API) createWebhook(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in webhook.Input
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	if err := a.mayWatch(r, c, in.MailboxID, in.DomainID); err != nil {
		return 0, nil, err
	}
	w, err := a.Webhooks.Create(r.Context(), in)
	return 201, w, err
}

func (a *API) patchWebhook(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var p webhook.Patch
	if err := httpx.Decode(r, &p); err != nil {
		return 0, nil, err
	}
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	current, err := a.Webhooks.Get(r.Context(), visible, chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	mbx, dom := current.MailboxID, current.DomainID
	if p.MailboxID.Set {
		mbx = p.MailboxID.Ptr()
	}
	if p.DomainID.Set {
		dom = p.DomainID.Ptr()
	}
	if err := a.mayWatch(r, c, mbx, dom); err != nil {
		return 0, nil, err
	}
	w, err := a.Webhooks.Update(r.Context(), visible, current.ID, p)
	return 200, w, err
}

func (a *API) deleteWebhook(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	id, disable := chi.URLParam(r, "id"), boolQuery(r, "disable_only")
	if err := a.Webhooks.Delete(r.Context(), visible, id, disable); err != nil {
		return 0, nil, err
	}
	if disable {
		w, err := a.Webhooks.Get(r.Context(), visible, id)
		return 200, w, err
	}
	return 200, map[string]any{"object": "webhook", "id": id, "deleted": true}, nil
}

// pingResult is 200 on success and 502 with the same body on failure.
func pingResult(res *webhook.Result, err error) (int, any, error) {
	if err != nil {
		return 0, nil, err
	}
	if !res.Succeeded {
		return 502, res, nil
	}
	return 200, res, nil
}

func (a *API) pingWebhook(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	return pingResult(a.Webhooks.Ping(r.Context(), visible, chi.URLParam(r, "id")))
}

func (a *API) listDeliveries(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	q := r.URL.Query()
	p, err := page.Parse(q)
	if err != nil {
		return 0, nil, err
	}
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	f := webhook.DeliveryFilter{Visible: visible, WebhookID: q.Get("webhook_id"), Event: q.Get("event"), Page: p}
	if v := q.Get("succeeded"); v != "" {
		b := v == "true"
		f.Succeeded = &b
	}
	list, err := a.Webhooks.Deliveries(r.Context(), f)
	return 200, list, err
}

func (a *API) replayDelivery(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	visible, err := a.visibleHooks(r, c)
	if err != nil {
		return 0, nil, err
	}
	return pingResult(a.Webhooks.Replay(r.Context(), visible, chi.URLParam(r, "id")))
}
