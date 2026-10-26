(() => {
  const message = (text, error = false) => {
    const el = document.getElementById('accessMessage');
    if (!el) return;
    el.hidden = false;
    el.classList.toggle('error', error);
    el.textContent = text;
    el.setAttribute('role', error ? 'alert' : 'status');
  };
  document.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.getAttribute('aria-controls'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide password' : 'Show password';
      button.setAttribute('aria-pressed', String(show));
    });
  });
  const query = new URLSearchParams(location.search);
  if (query.has('message')) message(query.get('message'), true);
  else if (query.has('loggedOut')) message('You have been logged out.');

  const login = document.getElementById('pageLoginForm');
  login?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = login.querySelector('[type=submit]');
    button.disabled = true;
    button.textContent = 'Logging in…';
    try {
      const result = await api.post('/auth/login', {
        email: login.elements.email.value.trim(),
        password: login.elements.password.value
      });
      api.setToken(result.token);
      api.setUser(result.user);
      window.location.assign('/app');
    } catch (error) {
      message(error.message || 'Login failed. Please try again.', true);
      button.disabled = false;
      button.textContent = 'Log in →';
    }
  });

  const register = document.getElementById('pageRegisterForm');
  if (register) {
    const role = register.elements.role;
    role.addEventListener('change', () => {
      const isSupplier = role.value === 'supplier';
      document.getElementById('companyField').hidden = !isSupplier;
      register.elements.companyName.required = isSupplier;
    });
    register.addEventListener('submit', async event => {
      event.preventDefault();
      if (register.elements.password.value !== register.elements.confirmPassword.value) {
        message('Passwords do not match. Please enter the same password in both fields.', true);
        register.elements.confirmPassword.focus();
        return;
      }
      const button = register.querySelector('[type=submit]');
      button.disabled = true;
      button.textContent = 'Submitting…';
      try {
        const body = Object.fromEntries(new FormData(register));
        delete body.confirmPassword;
        const result = await api.post('/auth/register', body);
        message(result.message);
        const link = document.createElement('a');
        link.href = '/login';
        link.textContent = 'Go to login after your account is approved →';
        document.getElementById('accessMessage').append(document.createElement('br'), link);
        register.hidden = true;
      } catch (error) {
        message(error.message || 'Could not submit registration. Please try again.', true);
        button.disabled = false;
        button.textContent = 'Submit registration →';
      }
    });
  }
})();
