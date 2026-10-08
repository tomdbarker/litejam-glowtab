import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DB_PATH = Path(os.environ.get('LITEJAM_DB_PATH', Path.home() / '.litejam-glowtab' / 'scales.sqlite3'))
ROOT_NOTES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')
DEFAULT_SCALES = (
    ('C Major', 'C', '2,4,5,7,9,11'),
    ('C Minor', 'C', '2,3,5,7,8,10'),
)
# Open-string MIDI notes (C4 = 60), string 1 (thinnest) first.
TUNING_MIN_MIDI = 35  # B1
TUNING_MAX_MIDI = 71  # B4
DEFAULT_TUNINGS = (
    ('Standard', (64, 59, 55, 50, 45, 40)),
    ('Drop D', (64, 59, 55, 50, 45, 38)),
    ('Half Step Down', (63, 58, 54, 49, 44, 39)),
    ('DADGAD', (62, 57, 55, 50, 45, 38)),
)
SESSION_TTL = 30 * 24 * 60 * 60
OAUTH_STATE_TTL = 10 * 60


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    os.chmod(DB_PATH, 0o600)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


def init_db():
    with connect() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                google_sub TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scales (
                id INTEGER PRIMARY KEY,
                owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                root_note TEXT NOT NULL,
                intervals TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                UNIQUE(owner_id, name)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS custom_scale_name_per_user
                ON scales(owner_id, name COLLATE NOCASE) WHERE owner_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS default_scale_name
                ON scales(name COLLATE NOCASE) WHERE is_default = 1;
            CREATE TABLE IF NOT EXISTS tunings (
                id INTEGER PRIMARY KEY,
                owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                notes TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS custom_tuning_name_per_user
                ON tunings(owner_id, name COLLATE NOCASE) WHERE owner_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS default_tuning_name
                ON tunings(name COLLATE NOCASE) WHERE is_default = 1;
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS oauth_states (
                state_hash TEXT PRIMARY KEY,
                nonce TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        ''')
        now = int(time.time())
        for name, root_note, intervals in DEFAULT_SCALES:
            db.execute(
                'INSERT OR IGNORE INTO scales (owner_id, name, root_note, intervals, is_default, created_at) '
                'VALUES (NULL, ?, ?, ?, 1, ?)',
                (name, root_note, intervals, now),
            )
        for name, notes in DEFAULT_TUNINGS:
            db.execute(
                'INSERT OR IGNORE INTO tunings (owner_id, name, notes, is_default, created_at) '
                'VALUES (NULL, ?, ?, 1, ?)',
                (name, ','.join(str(n) for n in notes), now),
            )


def validate_scale(name, root_note, intervals):
    name = (name or '').strip()
    if not name or len(name) > 60:
        raise ValueError('Scale name must be between 1 and 60 characters.')
    if root_note not in ROOT_NOTES:
        raise ValueError('Choose a valid root note.')
    if not isinstance(intervals, str):
        raise ValueError('Intervals must be comma-separated semitones.')
    parts = [part.strip() for part in intervals.split(',')]
    if not 6 <= len(parts) <= 11 or any(not re.fullmatch(r'\d+', part) for part in parts):
        raise ValueError('Enter 6–11 ascending intervals between 1 and 11.')
    values = [int(part) for part in parts]
    if any(value < 1 or value > 11 for value in values) or any(a >= b for a, b in zip(values, values[1:])):
        raise ValueError('Intervals must be strictly ascending values between 1 and 11.')
    if any(name.casefold() == default[0].casefold() for default in DEFAULT_SCALES):
        raise ValueError('That name is reserved for a built-in scale.')
    return name, root_note, ','.join(str(value) for value in values)


def list_scales(user_id=None):
    with connect() as db:
        rows = db.execute(
            'SELECT name, root_note, intervals, is_default FROM scales '
            'WHERE is_default = 1 OR owner_id = ? ORDER BY is_default DESC, name COLLATE NOCASE',
            (user_id,),
        ).fetchall()
    return [
        {
            'name': row['name'],
            'Root Note': row['root_note'],
            'Intervals': row['intervals'],
            'isDefault': bool(row['is_default']),
        }
        for row in rows
    ]


def save_scale(user_id, name, root_note, intervals):
    name, root_note, intervals = validate_scale(name, root_note, intervals)
    now = int(time.time())
    with connect() as db:
        existing = db.execute(
            'SELECT id FROM scales WHERE owner_id = ? AND name = ? COLLATE NOCASE',
            (user_id, name),
        ).fetchone()
        if existing:
            db.execute(
                'UPDATE scales SET name = ?, root_note = ?, intervals = ? WHERE id = ?',
                (name, root_note, intervals, existing['id']),
            )
        else:
            db.execute(
                'INSERT INTO scales (owner_id, name, root_note, intervals, is_default, created_at) '
                'VALUES (?, ?, ?, ?, 0, ?)',
                (user_id, name, root_note, intervals, now),
            )
    return {'name': name, 'Root Note': root_note, 'Intervals': intervals, 'isDefault': False}


def validate_tuning(name, notes):
    name = (name or '').strip()
    if not name or len(name) > 60:
        raise ValueError('Tuning name must be between 1 and 60 characters.')
    if (
        not isinstance(notes, list)
        or len(notes) != 6
        or any(isinstance(n, bool) or not isinstance(n, int) for n in notes)
        or any(n < TUNING_MIN_MIDI or n > TUNING_MAX_MIDI for n in notes)
    ):
        raise ValueError('Choose an open note between B1 and B4 for each of the 6 strings.')
    if any(name.casefold() == default[0].casefold() for default in DEFAULT_TUNINGS):
        raise ValueError('That name is reserved for a built-in tuning.')
    return name, list(notes)


def _tuning_row(row):
    return {
        'name': row['name'],
        'notes': [int(n) for n in row['notes'].split(',')],
        'isDefault': bool(row['is_default']),
    }


def list_tunings(user_id=None):
    with connect() as db:
        rows = db.execute(
            'SELECT name, notes, is_default FROM tunings WHERE is_default = 1 OR owner_id = ? '
            'ORDER BY is_default DESC, CASE WHEN is_default = 1 THEN id ELSE 0 END, name COLLATE NOCASE',
            (user_id,),
        ).fetchall()
    return [_tuning_row(row) for row in rows]


def save_tuning(user_id, name, notes):
    name, notes = validate_tuning(name, notes)
    joined = ','.join(str(n) for n in notes)
    with connect() as db:
        existing = db.execute(
            'SELECT id FROM tunings WHERE owner_id = ? AND name = ? COLLATE NOCASE',
            (user_id, name),
        ).fetchone()
        if existing:
            db.execute('UPDATE tunings SET name = ?, notes = ? WHERE id = ?', (name, joined, existing['id']))
        else:
            db.execute(
                'INSERT INTO tunings (owner_id, name, notes, is_default, created_at) VALUES (?, ?, ?, 0, ?)',
                (user_id, name, joined, int(time.time())),
            )
    return {'name': name, 'notes': notes, 'isDefault': False}


def _token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def create_oauth_state():
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    with connect() as db:
        db.execute('DELETE FROM oauth_states WHERE created_at < ?', (int(time.time()) - OAUTH_STATE_TTL,))
        db.execute(
            'INSERT INTO oauth_states (state_hash, nonce, created_at) VALUES (?, ?, ?)',
            (_token_hash(state), nonce, int(time.time())),
        )
    return state, nonce


def consume_oauth_state(state):
    if not state:
        return None
    with connect() as db:
        row = db.execute(
            'SELECT nonce, created_at FROM oauth_states WHERE state_hash = ?',
            (_token_hash(state),),
        ).fetchone()
        db.execute('DELETE FROM oauth_states WHERE state_hash = ?', (_token_hash(state),))
    if not row or int(time.time()) - row['created_at'] > OAUTH_STATE_TTL:
        return None
    return row['nonce']


def _google_request(url, data=None):
    if data is None:
        request = Request(url, headers={'Accept': 'application/json'})
    else:
        request = Request(
            url,
            data=urlencode(data).encode('utf-8'),
            headers={'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'},
        )
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def google_identity(code, redirect_uri, expected_nonce, client_id, client_secret):
    token_data = _google_request('https://oauth2.googleapis.com/token', {
        'code': code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    })
    id_token = token_data.get('id_token')
    if not id_token:
        raise ValueError('Google did not return an identity token.')

    parts = id_token.split('.')
    if len(parts) != 3:
        raise ValueError('Google returned an invalid identity token.')
    payload_segment = parts[1] + '=' * (-len(parts[1]) % 4)
    token_claims = json.loads(base64.urlsafe_b64decode(payload_segment))
    verified = _google_request(
        'https://oauth2.googleapis.com/tokeninfo?' + urlencode({'id_token': id_token})
    )

    if verified.get('aud') != client_id:
        raise ValueError('Google identity token was issued for a different application.')
    if verified.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        raise ValueError('Google identity token has an invalid issuer.')
    if int(verified.get('exp', 0)) <= int(time.time()):
        raise ValueError('Google identity token has expired.')
    if token_claims.get('nonce') != expected_nonce:
        raise ValueError('Google sign-in nonce did not match.')
    if str(verified.get('email_verified', '')).lower() != 'true':
        raise ValueError('A verified Google email address is required.')
    if not verified.get('sub') or not verified.get('email'):
        raise ValueError('Google did not return a user ID and email address.')

    return {
        'sub': verified['sub'],
        'email': verified['email'],
        'name': verified.get('name') or verified.get('given_name') or verified['email'],
    }


def upsert_google_user(identity):
    now = int(time.time())
    with connect() as db:
        db.execute(
            'INSERT INTO users (google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name',
            (identity['sub'], identity['email'], identity['name'], now),
        )
        row = db.execute('SELECT id FROM users WHERE google_sub = ?', (identity['sub'],)).fetchone()
    return row['id']


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    with connect() as db:
        now = int(time.time())
        db.execute('DELETE FROM sessions WHERE expires_at <= ?', (now,))
        db.execute(
            'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
            (_token_hash(token), user_id, now + SESSION_TTL),
        )
    return token


def get_session_user(token):
    if not token:
        return None
    with connect() as db:
        row = db.execute(
            'SELECT users.id, users.email, users.display_name FROM sessions '
            'JOIN users ON users.id = sessions.user_id '
            'WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
            (_token_hash(token), int(time.time())),
        ).fetchone()
    if not row:
        return None
    return {'id': row['id'], 'email': row['email'], 'name': row['display_name']}


def delete_session(token):
    if not token:
        return
    with connect() as db:
        db.execute('DELETE FROM sessions WHERE token_hash = ?', (_token_hash(token),))
