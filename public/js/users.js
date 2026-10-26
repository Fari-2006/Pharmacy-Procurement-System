// User & RBAC Management Module (Admin Only)
const usersManager = {
  users: [],

  async loadUsers() {
    try {
      const res = await api.get('/users');
      if (res.success) {
        this.users = res.users;
        this.renderTable(this.users);
      }
    } catch (error) {
      showToast(error.message || 'Failed to load user accounts.', 'error');
    }
  },

  renderTable(list) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No staff users found.</td></tr>';
      return;
    }

    const currentUserId = auth.currentUser?.id;

    tbody.innerHTML = list.map(u => {
      let roleBadge = 'role-pharmacist';
      if (u.role === 'admin') roleBadge = 'role-admin';
      if (u.role === 'cashier') roleBadge = 'role-cashier';

      const isSelf = u._id === currentUserId;

      return `
        <tr>
          <td>
            <strong>${u.name}</strong>
            ${isSelf ? '<span class="badge badge-info" style="margin-left:6px;">You</span>' : ''}
          </td>
          <td>${u.email}</td>
          <td><span class="role-badge ${roleBadge}">${u.role.toUpperCase()}</span></td>
          <td>${u.phone || '-'}</td>
          <td>
            ${u.registrationStatus === 'pending' ? '<span class="badge badge-warning">Pending Approval</span>' : u.isActive ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-danger">Deactivated</span>'}
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="usersManager.openEditModal('${u._id}')" title="Edit Staff">
                <i class="fa-solid fa-user-pen"></i> Edit
              </button>
              ${!isSelf ? `
                <button class="btn btn-danger btn-sm" onclick="usersManager.deleteUser('${u._id}')" title="Delete User">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openAddModal() {
    document.getElementById('addUserForm').reset();
    document.getElementById('addUserModal').classList.add('active');
  },

  openEditModal(id) {
    const u = this.users.find(user => user._id === id);
    if (!u) return;

    document.getElementById('editUserId').value = u._id;
    document.getElementById('editUserName').value = u.name;
    document.getElementById('editUserEmail').value = u.email;
    document.getElementById('editUserRole').value = u.role;
    document.getElementById('editUserPhone').value = u.phone || '';
    document.getElementById('editUserActive').checked = Boolean(u.isActive);
    document.getElementById('editUserPassword').value = '';

    let request=document.getElementById('registrationRequestDetails');
    if(!request){request=document.createElement('p');request.id='registrationRequestDetails';request.className='proc-warning';document.getElementById('editUserForm').prepend(request);}
    request.textContent = u.registrationStatus==='pending' ? 'Registration request: '+u.role+(u.requestedCompanyName?' · Company: '+u.requestedCompanyName:'')+'. Review the details, select a supplier company if required, and check Account Active to approve.' : '';
    request.hidden = u.registrationStatus!=='pending';
    document.getElementById('editUserModal').classList.add('active');
  },

  async deleteUser(id) {
    if (!confirm('Are you sure you want to delete this staff user account?')) return;

    try {
      const res = await api.delete(`/users/${id}`);
      if (res.success) {
        showToast('User deleted successfully.', 'success');
        this.loadUsers();
      }
    } catch (error) {
      showToast(error.message || 'Failed to delete user.', 'error');
    }
  }
};
