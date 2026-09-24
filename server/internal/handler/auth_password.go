package handler

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/logger"
)

// Break-glass password login for self-hosted operators. The email-code flow is
// the only way in, so a broken outbound mail provider locks the instance owner
// out of their own deployment. Enabled only when MULTICA_ADMIN_PASSWORD and
// MULTICA_ADMIN_EMAILS are both set; the email must already exist as a user, so
// this path never creates an account and never widens the signup allowlist.
const (
	adminPasswordEnv = "MULTICA_ADMIN_PASSWORD"
	adminEmailsEnv   = "MULTICA_ADMIN_EMAILS"
	adminOTPEnv      = "MULTICA_ADMIN_OTP"

	// Self-hosted instances typically run without REDIS_URL, which turns the
	// auth rate-limit middleware into a pass-through (see middleware.RateLimit).
	// Password length is therefore the real defence against online guessing, so
	// a short password disables the feature rather than weakening it.
	minAdminPasswordLen = 20

	// Mirrors the frontend hint cookie in apps/web/features/auth/auth-cookie.ts.
	// Not a credential — proxy.ts only reads it to decide whether to send an
	// anonymous visitor to /login. The real session is the HttpOnly auth cookie.
	loggedInHintCookie = "multica_logged_in"
)

// adminPassword returns the configured break-glass password, or "" when the
// feature is off (unset, or too short to be safe without rate limiting).
func adminPassword() string {
	pw := strings.TrimSpace(os.Getenv(adminPasswordEnv))
	if len(pw) < minAdminPasswordLen {
		return ""
	}
	return pw
}

func isAdminLoginEmail(email string) bool {
	for _, e := range strings.Split(os.Getenv(adminEmailsEnv), ",") {
		if e = strings.TrimSpace(e); e != "" && strings.EqualFold(e, email) {
			return true
		}
	}
	return false
}

// passwordMatches compares digests rather than the raw strings so the compare
// stays constant-time across differing lengths.
func passwordMatches(got, want string) bool {
	g := sha256.Sum256([]byte(got))
	w := sha256.Sum256([]byte(want))
	return subtle.ConstantTimeCompare(g[:], w[:]) == 1
}

// adminGuessMu serializes every fixed-secret comparison on this process and
// adminSecretMatches charges a second for each miss, capping the whole instance
// at roughly one guess per second. Without it the short OTP would be freely
// enumerable: middleware.RateLimit is a pass-through when REDIS_URL is unset,
// which is the normal self-hosted configuration.
// ponytail: process-local, so it resets on restart and does not span replicas;
// move the counter to Redis only if this ever runs multi-replica.
var adminGuessMu sync.Mutex

func adminSecretMatches(got, want string) bool {
	adminGuessMu.Lock()
	defer adminGuessMu.Unlock()
	if passwordMatches(got, want) {
		return true
	}
	time.Sleep(time.Second)
	return false
}

// adminOTP returns the fixed operator sign-in code, or "" when the feature is
// off. Exactly six characters because the web login page renders a six-slot
// OTP input; any character is accepted since that input sets no pattern.
func adminOTP() string {
	code := strings.TrimSpace(os.Getenv(adminOTPEnv))
	if utf8.RuneCountInString(code) != 6 {
		return ""
	}
	return code
}

// checkAdminVerificationCode reports whether code is the fixed operator code
// for this email. Unlike upstream's MULTICA_DEV_VERIFICATION_CODE, this is
// scoped to MULTICA_ADMIN_EMAILS and ignores APP_ENV — a fixed code good for
// every account is a backdoor on a public instance, not a break-glass.
func checkAdminVerificationCode(email, code string) bool {
	want := adminOTP()
	if want == "" || !isAdminLoginEmail(email) {
		return false
	}
	return adminSecretMatches(code, want)
}

var adminLoginTmpl = template.Must(template.New("adminLogin").Parse(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Multica — admin sign in</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#e8e8ea;
font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
form{width:min(360px,90vw);display:flex;flex-direction:column;gap:12px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
p{margin:0;color:#9a9aa2;font-size:13px}
input{padding:10px 12px;border-radius:8px;border:1px solid #333338;background:#141416;color:inherit;font:inherit}
input:focus{outline:2px solid #5b6cff;outline-offset:1px}
button{padding:10px 12px;border-radius:8px;border:0;background:#5b6cff;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:#ff8080}
</style></head><body>
<form method="post" action="/auth/password">
<h1>Admin sign in</h1>
<p>Break-glass login. Regular sign-in is at <a href="/login" style="color:#8f9bff">/login</a>.</p>
{{if .Error}}<p class="err">Incorrect email or password.</p>{{end}}
<input type="email" name="email" placeholder="Email" autocomplete="username" required autofocus>
<input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
<button type="submit">Sign in</button>
</form></body></html>`))

func (h *Handler) AdminPasswordLoginPage(w http.ResponseWriter, r *http.Request) {
	if adminPassword() == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = adminLoginTmpl.Execute(w, map[string]bool{"Error": r.URL.Query().Get("e") != ""})
}

func (h *Handler) AdminPasswordLogin(w http.ResponseWriter, r *http.Request) {
	want := adminPassword()
	if want == "" {
		http.NotFound(w, r)
		return
	}

	reject := func(reason string, email string) {
		// The guessing brake lives in adminSecretMatches; the paths that reach
		// here without one (bad form, unknown user) already required a correct
		// password, so they need no extra delay.
		slog.Warn("admin password login rejected", append(logger.RequestAttrs(r), "reason", reason, "email", email)...)
		http.Redirect(w, r, "/auth/password?e=1", http.StatusSeeOther)
	}

	if err := r.ParseForm(); err != nil {
		reject("bad form", "")
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.PostFormValue("email")))

	// Always compare the password, even for a non-admin email, so a wrong
	// address and a wrong password cost the same.
	okPassword := adminSecretMatches(r.PostFormValue("password"), want)
	if !isAdminLoginEmail(email) || !okPassword {
		reject("bad credentials", email)
		return
	}

	// Existing users only — no findOrCreateUser here, so the break-glass path
	// can never mint an account that signup rules would have refused.
	user, err := h.Queries.GetUserByEmail(r.Context(), email)
	if err != nil {
		reject("no such user", email)
		return
	}
	if auth.IsTemporarilyDisabledUser(uuidToString(user.ID), user.Email) {
		reject("user disabled", email)
		return
	}

	token, err := h.issueJWT(user)
	if err != nil {
		if errors.Is(err, auth.ErrTemporarilyDisabledUser) {
			reject("user disabled", email)
			return
		}
		slog.Error("admin password login: issue token", append(logger.RequestAttrs(r), "error", err, "email", email)...)
		http.Error(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	if err := auth.SetAuthCookies(w, token); err != nil {
		slog.Warn("admin password login: failed to set auth cookies", "error", err)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     loggedInHintCookie,
		Value:    "1",
		Path:     "/",
		MaxAge:   int(auth.AuthTokenTTL().Seconds()),
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
	})

	slog.Info("user logged in (admin password)", append(logger.RequestAttrs(r), "user_id", uuidToString(user.ID), "email", user.Email)...)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
