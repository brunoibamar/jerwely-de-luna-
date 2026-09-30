// ============================================================
//  ErrorBoundary: Capturador Global de Errores
//  Evita que una excepción no controlada deje la pantalla en
//  blanco o bloqueada. Muestra una alerta amigable y reconstruye
//  únicamente el componente afectado en lugar de recargar toda
//  la página.
//
//  - window.onerror: captura excepciones síncronas no controladas.
//  - unhandledrejection: captura promesas rechazadas sin .catch().
//  - wrap(): envuelve callbacks/renderizados para atribuir el error
//    a un componente específico y permitir una recuperación local.
// ============================================================

class ErrorBoundary {
    static isInitialized = false
    static isRecovering = false
    static errorCooldown = 0
    static errorCount = 0
    static currentComponent = null

    static init() {
        if (this.isInitialized) return
        this.isInitialized = true
        this.bindGlobalHandlers()
    }

    static bindGlobalHandlers() {
        // Preservar cualquier manejador anterior para no romper integraciones
        const previousOnError = window.onerror
        window.onerror = (message, source, lineno, colno, error) => {
            if (previousOnError) {
                const result = previousOnError(message, source, lineno, colno, error)
                if (result) return true
            }
            this.handleError({
                type: 'runtime',
                message: message,
                source: source,
                lineno: lineno,
                colno: colno,
                error: error || new Error(message)
            })
            // Devolver true evita el comportamiento por defecto del navegador
            return true
        }

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason
            const error = reason instanceof Error
                ? reason
                : new Error(reason != null ? String(reason) : 'Promesa rechazada')

            this.handleError({
                type: 'promise',
                message: error.message || 'Promesa rechazada sin mensaje',
                source: error.stack,
                error: error
            })
            // Evita el registro duplicado en la consola del navegador
            event.preventDefault()
        })
    }

    static handleError(info) {
        // No reentrar mientras se recupera un componente
        if (this.isRecovering) return
        // Evitar bucles de recuperación y spam de notificaciones
        const now = Date.now()
        if (now - this.errorCooldown < 1000) return
        this.errorCooldown = now

        this.errorCount += 1
        if (this.errorCount > 10) {
            console.warn('[ErrorBoundary] Demasiados errores consecutivos. Recargando página.')
            location.reload()
            return
        }

        try {
            console.error('[ErrorBoundary] Error capturado:', info)
        } catch (e) {
            // La consola no debe interrumpir el flujo de recuperación
        }

        this.showAlert(info)

        // Intentar recuperar el componente afectado tras un breve retardo
        setTimeout(() => {
            this.recover(info)
        }, 500)
    }

    static showAlert(info) {
        // Alerta no bloqueante vía Toast (reutiliza el sistema existente)
        try {
            if (typeof Toast !== 'undefined' && Toast.error) {
                const safeMsg = (info.message || 'Error desconocido')
                Toast.error(`Error: ${safeMsg}`, 6000)
            }
        } catch (e) {
            // El Toast también puede fallar; usar alerta nativa como último recurso
            alert(`Error: ${info.message || 'Error desconocido'}`)
        }

        // Banner informativo con acciones de recuperación
        this.renderErrorBanner(info)
    }

    static renderErrorBanner(info) {
        this.removeErrorBanner()

        const banner = document.createElement('div')
        banner.id = 'error-boundary-banner'
        banner.className = 'error-banner'
        banner.setAttribute('role', 'alert')

        const safeMessage = this.escapeHtml(info.message || 'Error desconocido')
        const safeComponent = this.escapeHtml(this.currentComponent || 'componente desconocido')

        banner.innerHTML = `
            <div class="error-banner-body">
                <span class="error-banner-icon">⚠️</span>
                <div class="error-banner-content">
                    <div class="error-banner-title">Algo salió mal en: ${safeComponent}</div>
                    <div class="error-banner-message">${safeMessage}</div>
                </div>
                <div class="error-banner-actions">
                    <button type="button" id="error-retry-btn" class="btn btn-primary btn-sm">Recargar componente</button>
                    <button type="button" id="error-dismiss-btn" class="btn btn-outline btn-sm">Descartar</button>
                </div>
            </div>
        `

        // Insertar al inicio del <body> para que sea visible
        document.body.insertBefore(banner, document.body.firstChild)

        const retryBtn = banner.querySelector('#error-retry-btn')
        const dismissBtn = banner.querySelector('#error-dismiss-btn')

        retryBtn?.addEventListener('click', () => {
            this.removeErrorBanner()
            this.recover(info)
        })

        dismissBtn?.addEventListener('click', () => {
            this.removeErrorBanner()
        })
    }

    static recover(info) {
        // Prevenir re-entrada durante la recuperación
        if (this.isRecovering) return
        this.isRecovering = true

        try {
            const app = window.app
            if (!app || !app.isInitialized) {
                throw new Error('App no inicializada')
            }

            // Determinar el componente afectado (sección activa o el explicitado)
            const component = this.currentComponent || app.activeSection
            this.recoverComponent(app, component)

            try {
                Toast.success('Componente recuperado correctamente')
            } catch (e) {
                // Toast no disponible
            }
        } catch (recoveryError) {
            console.error('[ErrorBoundary] Falló la recuperación:', recoveryError)
            try {
                Toast.error('No se pudo recuperar el componente. Recargando página...')
            } catch (e) {}
            setTimeout(() => location.reload(), 1500)
        } finally {
            this.isRecovering = false
            this.currentComponent = null
        }
    }

    static recoverComponent(app, component) {
        // Mapear el componente/operación a un método de renderizado específico.
        // Siempre se re-renderiza la sección activa (el "componente afectado").
        const section = app.activeSection || 'sales'

        // Re-ejecutar el cambio de sección para reconstruir su contenido
        app.switchSection(section)

        // Re-renderizar el carrito cuando la sección activa es Ventas
        if (section === 'sales' && app.cart && typeof app.cart.render === 'function') {
            app.cart.render()
            if (typeof app.cart.updateTotals === 'function') {
                app.cart.updateTotals()
            }
        }

        // Restablecer la visibilidad basada en roles
        if (typeof app.updateRoleVisibility === 'function') {
            app.updateRoleVisibility()
        }
    }

    static removeErrorBanner() {
        const existing = document.getElementById('error-boundary-banner')
        if (existing) existing.remove()
    }

    // Envolver una función para atribir errores a un componente concreto.
    // Permite aislar la recuperación al componente que falla.
    // Uso: button.addEventListener('click', ErrorBoundary.wrap('add-product', () => { ... }))
    static wrap(component, fn) {
        return function wrapped(...args) {
            const previous = ErrorBoundary.currentComponent
            ErrorBoundary.currentComponent = component
            try {
                return fn.apply(this, args)
            } catch (error) {
                ErrorBoundary.handleError({
                    type: 'wrapped',
                    message: error?.message || String(error),
                    source: error?.stack || null,
                    error: error || new Error(String(error))
                })
                return undefined
            } finally {
                ErrorBoundary.currentComponent = previous
            }
        }
    }

    static escapeHtml(text) {
        if (text == null) return ''
        const div = document.createElement('div')
        div.textContent = String(text)
        return div.innerHTML
    }
}

// Exponer globalmente como el resto de clases del proyecto
window.ErrorBoundary = ErrorBoundary

// Registrar los manejadores tan pronto como el script se carga,
// para interceptar errores durante la propia inicialización de la app.
ErrorBoundary.init()
