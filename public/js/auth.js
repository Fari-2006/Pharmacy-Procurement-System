// Authentication & Role-Based Access Control Module
const auth = {
  currentUser: null,

  init() {
    this.currentUser = api.getUser();
    this.bindEvents();

    if (api.getToken() && this.currentUser) {
      this.applyUserSession();
    } else {
      this.showLoginModal();
    }

    window.addEventListener('auth:expired', () => {
      this.showLoginModal('Your session has expired. Please log in again.');
    });
  },

  bindEvents() {
    // Standard login form submission
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        await this.login(email, password);
      });
    }

    // Demo One-Click Login Buttons
    document.querySelectorAll('.btn-demo-login').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const role = e.currentTarget.dataset.role;
        let email = '';
        let pass = '';

        if (role === 'admin') {
          email = 'admin@pharmacy.com';
          pass = 'Admin@123';
        } else if (role === 'pharmacist') {
          email = 'pharmacist@pharmacy.com';
          pass = 'Pharma@123';
        } else if (role === 'cashier') {
          email = 'cashier@pharmacy.com';
          pass = 'Cashier@123';
        }

        document.getElementById('loginEmail').value = email;
        document.getElementById('loginPassword').value = pass;
        await this.login(email, pass);
      });
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.logout());
    }
  },

  async login(email, password) {
    try {
      const res = await api.post('/auth/login', { email, password });
      if (res.success) {
        api.setToken(res.token);
        api.setUser(res.user);
        this.currentUser = res.user;

        this.hideLoginModal();
        this.applyUserSession();
        showToast(`Welcome back, ${res.user.name}! (${res.user.role.toUpperCase()})`, 'success');

        // Trigger view refresh
        window.dispatchEvent(new CustomEvent('auth:login_success', { detail: res.user }));
      }
    } catch (error) {
      showToast(error.message || 'Login failed. Please check your credentials.', 'error');
    }
  },

  logout() {
    api.removeToken();
    api.removeUser();
    this.currentUser = null;
    showToast('Logged out successfully.', 'info');
    this.showLoginModal();
  },

  showLoginModal(msg) {
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.add('active');
      if (msg) {
        const alertEl = document.getElementById('loginAlertMsg');
        if (alertEl) {
          alertEl.textContent = msg;
          alertEl.style.display = 'block';
        }
      }
    }
  },

  hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.remove('active');
      const alertEl = document.getElementById('loginAlertMsg');
      if (alertEl) alertEl.style.display = 'none';
    }
  },

  applyUserSession() {
    if (!this.currentUser) return;

    // Update UI profile elements
    const nameEl = document.getElementById('headerUserName');
    const roleEl = document.getElementById('headerUserRole');
    const avatarEl = document.getElementById('userAvatarText');

    if (nameEl) nameEl.textContent = this.currentUser.name;
    if (roleEl) {
      roleEl.textContent = this.currentUser.role.toUpperCase();
      roleEl.className = `role-badge role-${this.currentUser.role}`;
    }
    if (avatarEl) {
      const initials = this.currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      avatarEl.textContent = initials;
    }

    // Role-based navigation gating
    const role = this.currentUser.role;
    document.querySelectorAll('[data-role-required]').forEach(el => {
      const allowedRoles = el.dataset.roleRequired.split(',').map(r => r.trim());
      if (allowedRoles.includes(role)) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });

    // If Cashier logs in and current active view is admin-only, switch to POS
    const currentView = document.querySelector('.view-section.active')?.id;
    if (role === 'cashier' && (currentView === 'view-users' || currentView === 'view-suppliers')) {
      if (window.appRouter) window.appRouter.navigateTo('pos');
    }
  },

  hasRole(...roles) {
    return this.currentUser && roles.includes(this.currentUser.role);
  }
};
