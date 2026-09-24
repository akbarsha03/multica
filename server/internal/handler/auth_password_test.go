package handler

import "testing"

func TestAdminPasswordRequiresLength(t *testing.T) {
	t.Setenv(adminPasswordEnv, "short")
	if adminPassword() != "" {
		t.Fatal("a password under the minimum length must disable the feature")
	}
	long := "correct-horse-battery-staple-1"
	t.Setenv(adminPasswordEnv, "  "+long+"  ")
	if adminPassword() != long {
		t.Fatalf("want %q, got %q", long, adminPassword())
	}
}

func TestIsAdminLoginEmail(t *testing.T) {
	t.Setenv(adminEmailsEnv, " Hello@Shabuilds.Tech , ops@example.com ")
	for _, e := range []string{"hello@shabuilds.tech", "ops@example.com"} {
		if !isAdminLoginEmail(e) {
			t.Errorf("%s should be an admin email", e)
		}
	}
	for _, e := range []string{"", "  ", "attacker@example.com"} {
		if isAdminLoginEmail(e) {
			t.Errorf("%q must not be an admin email", e)
		}
	}
	t.Setenv(adminEmailsEnv, "")
	if isAdminLoginEmail("") {
		t.Error("empty allowlist must match nothing, including the empty email")
	}
}

func TestPasswordMatches(t *testing.T) {
	if !passwordMatches("s3cret-value-long-enough", "s3cret-value-long-enough") {
		t.Error("identical passwords must match")
	}
	if passwordMatches("s3cret-value-long-enoug", "s3cret-value-long-enough") {
		t.Error("different-length passwords must not match")
	}
	if passwordMatches("", "s3cret-value-long-enough") {
		t.Error("empty password must not match")
	}
}

func TestAdminOTPRequiresSixChars(t *testing.T) {
	for _, bad := range []string{"", "12345", "1234567"} {
		t.Setenv(adminOTPEnv, bad)
		if adminOTP() != "" {
			t.Errorf("%q is not six characters and must disable the fixed code", bad)
		}
	}
	t.Setenv(adminOTPEnv, " f3AkNW ")
	if got := adminOTP(); got != "f3AkNW" {
		t.Fatalf("want f3AkNW, got %q", got)
	}
}

func TestCheckAdminVerificationCode(t *testing.T) {
	t.Setenv(adminEmailsEnv, "admin@example.com")
	t.Setenv(adminOTPEnv, "f3AkNW")

	if !checkAdminVerificationCode("admin@example.com", "f3AkNW") {
		t.Error("the configured code must let the admin email in")
	}
	// Scoped to the admin allowlist: a fixed code good for any account would
	// be a backdoor, which is the whole reason we do not use APP_ENV+dev code.
	if checkAdminVerificationCode("someone@example.com", "f3AkNW") {
		t.Error("a non-admin email must not be accepted")
	}
	if checkAdminVerificationCode("admin@example.com", "000000") {
		t.Error("a wrong code must be rejected")
	}

	t.Setenv(adminOTPEnv, "")
	if checkAdminVerificationCode("admin@example.com", "") {
		t.Error("an unset code must not turn the empty string into a valid login")
	}
}
