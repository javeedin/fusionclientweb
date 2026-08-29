# ─────────────────────────────────────────────────────────────────────────────
# ReportBro render service for the FusionClient Report Designer
#
# Implements the standard ReportBro server protocol used by both the designer
# preview and the app's Run flow:
#
#   PUT /report/run   body: {report, outputFormat, data, isTestData}
#                     → "key:<id>" on success (file cached ~10 min)
#                     → {"errors":[...]} JSON when the report is invalid
#   GET /report/run?key=<id>&outputFormat=pdf|xlsx
#                     → the rendered file
#
# Point the React app at it with:
#   REACT_APP_REPORTBRO_SERVER_URL=https://<host>:8001/report/run
#
# Run:
#   pip install reportbro-lib flask flask-cors
#   python reportbro-server.py            (PORT env var overrides 8001)
#
# Deploy anywhere Python runs — an OCI compute instance / container next to
# the ADB is the natural home. Add TLS (reverse proxy) before production use.
# ─────────────────────────────────────────────────────────────────────────────
import os
import time
import uuid

from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from reportbro import Report, ReportBroError

app = Flask(__name__)
CORS(app)  # the app calls from a different origin (Vercel / APEX / Electron)

MAX_CACHE_AGE = 600  # seconds a rendered file stays available for pickup
_cache = {}          # key -> (timestamp, output_format, bytes)


def _evict():
    now = time.time()
    for key in [k for k, (ts, _f, _d) in _cache.items() if now - ts > MAX_CACHE_AGE]:
        _cache.pop(key, None)


@app.route('/report/run', methods=['PUT'])
def run_report():
    _evict()
    body = request.get_json(force=True, silent=True) or {}
    report_definition = body.get('report')
    output_format = body.get('outputFormat', 'pdf')
    data = body.get('data', {})
    is_test_data = bool(body.get('isTestData', False))

    if not report_definition:
        return jsonify(errors=[dict(msg_key='errorMsgMissingReport', object_id=None, field=None)]), 400
    if output_format not in ('pdf', 'xlsx'):
        return jsonify(errors=[dict(msg_key='errorMsgUnsupportedOutputFormat', object_id=None, field=None)]), 400

    try:
        report = Report(report_definition, data, is_test_data)
    except Exception as e:  # malformed definition
        return jsonify(errors=[dict(msg_key='errorMsgInvalidReport', object_id=None, field=None, info=str(e)[:500])]), 400

    if report.errors:
        return jsonify(errors=report.errors), 400

    try:
        rendered = report.generate_pdf() if output_format == 'pdf' else report.generate_xlsx()
    except ReportBroError as err:
        return jsonify(errors=[err.error if isinstance(err.error, dict) else dict(
            msg_key='errorMsgInvalidReport', object_id=None, field=None, info=str(err)[:500])]), 400
    except Exception as e:
        return jsonify(errors=[dict(msg_key='errorMsgRenderFailed', object_id=None, field=None, info=str(e)[:500])]), 500

    key = str(uuid.uuid4())
    _cache[key] = (time.time(), output_format, bytes(rendered))
    return f'key:{key}'


@app.route('/report/run', methods=['GET'])
def get_report_file():
    _evict()
    key = request.args.get('key', '')
    entry = _cache.get(key)
    if not entry:
        return jsonify(error='report not found (expired?)'), 404
    _ts, output_format, blob = entry
    response = make_response(blob)
    if output_format == 'xlsx':
        response.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        response.headers['Content-Disposition'] = 'attachment; filename="report.xlsx"'
    else:
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = 'inline; filename="report.pdf"'
    return response


@app.route('/health', methods=['GET'])
def health():
    return jsonify(status='ok', cached=len(_cache))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8001'))
    app.run(host='0.0.0.0', port=port)
