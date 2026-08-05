"""The single HTML page; everything else happens over the JSON API."""

import re

from flask import Blueprint, render_template

from .. import config

bp = Blueprint("views", __name__)


@bp.route("/")
def index():
    def display_model_name(model):
        model_id = model.rsplit("/", 1)[-1]
        if model_id.lower() == "gpt-oss-20b":
            return "GPT OSS 20B"
        return re.sub(r"[-_]+", " ", model_id).title() or model

    # Both are only starting values. The assistant asks each provider what it
    # actually serves and rewrites these, so a model renamed or retired
    # upstream shows up here rather than as a failed question. The dash is the
    # same "no value yet" marker the dashboard's own cards use.
    return render_template(
        "index.html",
        cloud_llm_name=display_model_name(config.GROQ_MODEL),
        local_llm_name=(
            display_model_name(config.LOCAL_LLM_MODEL)
            if config.LOCAL_LLM_MODEL else "—"
        ),
    )
