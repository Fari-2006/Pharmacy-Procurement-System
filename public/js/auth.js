// Authentication for the protected workspace. Public login is at /login.
const auth = {
  currentUser: null,
  async init() {
    window.addEventListener('auth:expired', () => this.showLoginModal('Your session has expired. Please log in again.'));
    this.bindEvents();
    if (!api.getToken()) { this.showLoginModal(); return false; }
    try {
      const result = await api.get('/auth/me');
      this.currentUser = {...result.user, id: result.user.id || result.user._id};
      api.setUser(this.currentUser);
      this.applyUserSession();
      document.body.classList.add('session-ready');
      return true;
    } catch (error) {
      this.currentUser = null;
      api.removeToken(); api.removeUser();
      this.showLoginModal(error.message);
      return false;
    }
  },
  bindEvents() {
    document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
  },
  logout() {
    api.removeToken(); api.removeUser(); this.currentUser=null;
    window.location.replace('/login?loggedOut=1');
  },
  showLoginModal(message) {
    const query = message ? '?message=' + encodeURIComponent(message) : '';
    window.location.replace('/login' + query);
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
