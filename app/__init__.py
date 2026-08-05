"""Flask application factory: wires config, blueprints, static and templates."""

import logging
from datetime import timedelta

from flask import Flask, jsonify, request

from . import config


def _register_error_handlers(app):
    """Answer API failures with JSON.

    Flask's defaults are HTML error pages. The frontend parses every response
    as JSON, so an HTML 413 or 500 surfaces to the user as an unrelated parse
    failure rather than the real problem.
    """
    def api_error(status, message, reason):
        def handler(exc):
            if not request.path.startswith("/api/"):
                return exc
            return jsonify({"error": message, "reason": reason}), status
        return handler

    app.register_error_handler(404, api_error(404, "Not found.", "not_found"))
    app.register_error_handler(
        405, api_error(405, "Method not allowed.", "method_not_allowed"))
    app.register_error_handler(413, api_error(
        413,
        "This file is larger than the "
        f"{config.MAX_CONTENT_LENGTH // (1024 * 1024)} MB upload limit.",
        "too_large",
    ))

    @app.errorhandler(500)
    def internal_error(exc):
        app.logger.exception("Unhandled error on %s", request.path)
        if not request.path.startswith("/api/"):
            return exc
        return jsonify({
            "error": "Something went wrong on the server.",
            "reason": "server_error",
        }), 500


# Every script, style, font and image the page uses is served from this app, so
# the policy can stay strict. 'unsafe-inline' is granted to styles alone: the
# templates set widths and colours through style attributes, while no inline
# script or event-handler attribute exists anywhere in them. blob: covers the
# recap card the browser renders and saves locally.
CSP = "; ".join((
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
))


def _register_security_headers(app):
    """A second line of defence behind the escaping the renderers already do."""
    @app.after_request
    def security_headers(response):
        response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response


def create_app():
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # static/ and templates/ live inside this package, so Flask finds both
    # without extra configuration.
    app = Flask(__name__)
    app.secret_key = config.FLASK_SECRET
    app.config.update(
        MAX_CONTENT_LENGTH=config.MAX_CONTENT_LENGTH,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Only meaningful behind HTTPS; setting it in development would stop
        # the cookie being stored at all over plain http://localhost.
        SESSION_COOKIE_SECURE=config.IS_PRODUCTION,
        PERMANENT_SESSION_LIFETIME=timedelta(days=config.SESSION_LIFETIME_DAYS),
    )

    _register_error_handlers(app)
    _register_security_headers(app)

    from .routes import api, chat, views
    app.register_blueprint(views.bp)
    app.register_blueprint(api.bp)
    app.register_blueprint(chat.bp)
    return app
