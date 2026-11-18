// Autorización temporal en esta pestaña. No cambia el usuario ni la caja.
class GuestAdminAccess {
    static refresh() {
        const active = Auth.hasTemporaryAdminAccess();
        const button = document.getElementById('guest-admin-access-btn');
        if (button) {
            button.classList.toggle('hidden', !Auth.currentUser || !Auth.isGuest());
            button.setAttribute('aria-pressed', String(active));
            button.setAttribute('aria-label', active ? 'Acceso administrador activo. Bloquear acceso' : 'Activar acceso administrador');
            button.title = active ? 'Desactivar acceso administrador y conservar la caja abierta' : 'Habilitar acceso administrador';
            document.getElementById('guest-admin-access-label').textContent = active ? 'Admin activo' : 'Acceso admin';
            document.getElementById('guest-admin-access-action').hidden = !active;
            document.getElementById('guest-admin-lock-shackle').setAttribute('d', active ? 'M8 11V7a4 4 0 0 1 7.5-2' : 'M8 11V7a4 4 0 0 1 8 0v4');
        }
        const status = document.getElementById('guest-admin-access-status');
        if (status) {
            status.classList.toggle('hidden', !active);
            const text = active ? 'Acceso administrador activado. El turno sigue siendo de invitado.' : '';
            if (status.textContent !== text) status.textContent = text;
        }
        const settings = document.getElementById('guest-admin-password-section');
        if (settings) settings.disabled = !Auth.canChangeGuestAdminPassword();
        document.getElementById('guest-admin-password-restriction')?.classList.toggle('hidden', Auth.canChangeGuestAdminPassword());
        // Las credenciales de inicio de sesión también siguen reservadas al dueño.
        for (const id of ['admin-current-pass', 'admin-new-pass', 'admin-confirm-pass', 'change-admin-pass-btn',
            'guest-current-key', 'guest-new-key', 'guest-confirm-key', 'change-guest-key-btn']) {
            const control = document.getElementById(id); if (control) control.disabled = !Auth.isAdmin();
        }
    }

    static lock(notify = true) {
        Auth.disableGuestAdminAccess();
        document.getElementById('guest-admin-access-dialog')?.close();
        document.getElementById('guest-admin-access-form')?.reset();
        document.querySelectorAll('.payment-overlay').forEach(el => el.remove());
        document.getElementById('monthly-archive-dialog')?.close();
        window.app?.updateRoleVisibility();
        window.app?.cart.render();
        if (Auth.isGuest() && ['inventory', 'reports', 'settings'].includes(window.app?.activeSection)) window.app.switchSection('sales');
        this.refresh();
        if (notify) Toast.info('Acceso administrador desactivado. La caja y el carrito se conservan.');
    }

    static init() {
        const dialog = document.getElementById('guest-admin-access-dialog');
        const form = document.getElementById('guest-admin-access-form');
        document.getElementById('guest-admin-access-btn')?.addEventListener('click', () => {
            if (!Auth.currentUser || !Auth.isGuest()) return;
            if (Auth.hasTemporaryAdminAccess()) { this.lock(); return; }
            if (!Auth.canRequestGuestAdminAccess()) { Toast.warning('Se necesita una caja abierta y una sesión de invitado para habilitar este acceso.'); return; }
            form.reset(); document.getElementById('guest-admin-access-error').textContent = '';
            dialog.showModal(); document.getElementById('guest-admin-access-password').focus();
        });
        document.getElementById('guest-admin-access-cancel')?.addEventListener('click', () => dialog.close());
        dialog?.addEventListener('close', () => form.reset());
        form?.addEventListener('submit', event => {
            event.preventDefault();
            const result = Auth.enableGuestAdminAccess(document.getElementById('guest-admin-access-password').value);
            form.reset();
            if (!result.success) { document.getElementById('guest-admin-access-error').textContent = result.error; return; }
            dialog.close(); window.app.updateRoleVisibility(); window.app.cart.render(); this.refresh();
            Toast.success('Acceso administrador habilitado para este turno. El usuario de la caja sigue siendo invitado.');
        });
        document.getElementById('change-guest-admin-password-btn')?.addEventListener('click', () => {
            const message = document.getElementById('guest-admin-password-message');
            try {
                const result = Auth.changeGuestAdminPassword(
                    document.getElementById('guest-admin-current-password').value,
                    document.getElementById('guest-admin-new-password').value,
                    document.getElementById('guest-admin-confirm-password').value);
                message.textContent = result.message || result.error;
                if (result.success) for (const id of ['guest-admin-current-password', 'guest-admin-new-password', 'guest-admin-confirm-password']) document.getElementById(id).value = '';
            } catch (error) { message.textContent = 'No se confirmó el cambio de contraseña: ' + error.message; }
        });
        window.addEventListener('storage', event => {
            if ([Cut.storageKey, Auth.current_userKey, Auth.guestAdminPasswordKey].includes(event.key)) this.lock(false);
        });
        window.addEventListener('pagehide', () => this.lock(false));
        window.addEventListener('pageshow', () => { if (window.app?.isInitialized) { window.app.updateRoleVisibility(); window.app.cart.render(); } });
        this.refresh();
    }
}
window.GuestAdminAccess = GuestAdminAccess;
document.addEventListener('DOMContentLoaded', () => GuestAdminAccess.init());
