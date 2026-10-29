"""Offline lexical safety checks; no SQL parser, database, network or writes.

Run from any directory: python docs/check_supabase_readonly.py
This allowlist checks these two reviewed files, not arbitrary SQL semantics.
"""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
FILES = [ROOT / "supabase-production-readonly.sql", ROOT / "supabase-production-readonly-data.sql"]
FUNCTIONS = set("""current_setting statement_timestamp has_database_privilege
current_database has_table_privilege row_security_active has_schema_privilege
aclexplode acldefault cardinality count md5 string_agg pg_my_temp_schema encode
has_any_column_privilege pg_has_role has_function_privilege chr unnest char_length
generate_series ascii substr btrim isfinite octet_length substring left right
split_part strpos length regexp_split_to_array array_length""".split())
CONSTRUCTS = set("""expected as in filter coalesce where on functions with
whitespace codepoints fields measured pos classified times parsed parts hosts
labels evaluated octets dns least sources exists values and or not when then
any all over""".split())


def inspect(sql, phase):
    clean, raw, quoted = [], [], []
    index, depth, mode = 0, 0, "code"
    identifier = []
    while index < len(sql):
        char = sql[index]
        if mode == "comment":
            if char == "\n":
                mode = "code"
                clean.append(" ")
                raw.append(" ")
        elif mode == "single":
            raw.append(char)
            if char == "'":
                if index + 1 < len(sql) and sql[index + 1] == "'":
                    raw.append("'")
                    index += 1
                else:
                    mode = "code"
                    clean.append(" ")
        elif mode == "double":
            raw.append(char)
            if char == '"':
                if index + 1 < len(sql) and sql[index + 1] == '"':
                    identifier.append('"')
                    raw.append('"')
                    index += 1
                else:
                    mode = "code"
                    quoted.append("".join(identifier))
                    clean.append(" quoted_identifier ")
            else:
                identifier.append(char)
        elif sql[index:index + 2] == "--":
            mode = "comment"
            index += 1
        elif char == "'":
            mode = "single"
            raw.append(char)
        elif char == '"':
            mode = "double"
            identifier = []
            raw.append(char)
        else:
            clean.append(char)
            raw.append(char)
            if char == "(":
                depth += 1
            if char == ")":
                depth -= 1
                assert depth >= 0, "Unbalanced parentheses"
        index += 1
    assert mode == "code" and depth == 0, "Incomplete lexical structure"
    code, raw = "".join(clean), "".join(raw)
    assert set(quoted) <= {"C"}, "Unexpected quoted identifier"
    assert not any(item in code for item in ["/*", "*/", "$", "\\"]), "Unsupported syntax"
    statements = [part.strip() for part in code.split(";") if part.strip()]
    assert statements[0] == "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    assert statements[-1] == "ROLLBACK"
    assert sum(part.startswith("BEGIN ") for part in statements) == 1
    assert not re.search(
        r"\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|"
        r"EXECUTE|COMMIT|INTO|LOCK|SHARE|SAVEPOINT)\b", code, re.I
    ), "Forbidden command or locking syntax"
    assert all(re.match(r"^(BEGIN|SET|SELECT|WITH|ROLLBACK)\b", part) for part in statements)
    assert not re.search(r"\bpg_catalog\.(pg_authid|pg_settings)\b", code)
    for schema, function in re.findall(r"\b([a-z_]+)\.([a-z_]+)\s*\(", code, re.I):
        assert schema == "pg_catalog" and function in FUNCTIONS, "Unknown function"
    for function in re.findall(r"(?<![\w.])([a-z_]+)\s*\(", code, re.I):
        assert function.lower() in CONSTRUCTS, "Unqualified function or unknown construct"
    if phase == 1:
        assert not re.search(r"\b(public|private|supabase_migrations)\.", code)
        assert not re.search(r"\b(?:FROM|JOIN)\s+(?!LATERAL\b)(\w+)\.", code.replace("pg_catalog.", ""), re.I)
    assert "pg_get_" not in code and "format_type" not in code, "Deparser not allowed"
    settings = re.findall(r"^SET LOCAL[^;]*;", raw, re.M)
    expected = {
        "SET LOCAL search_path = pg_catalog;",
        "SET LOCAL standard_conforming_strings = on;",
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '2s';",
        "SET LOCAL idle_in_transaction_session_timeout = '60s';",
    }
    if phase == 2:
        expected.add("SET LOCAL row_security = off;")
    assert set(settings) == expected and len(settings) == len(expected), "Unexpected setting"
    return len(statements)


def main():
    if not __debug__:
        raise RuntimeError("Run without -O: assertion checks must remain enabled")
    texts = [path.read_text(encoding="utf-8") for path in FILES]
    for phase, (path, text) in enumerate(zip(FILES, texts), 1):
        assert "\ufffd" not in text
        print(f"Phase {phase}: {inspect(text, phase)} statements checked ({path.name})")
    mutations = [
        "INSERT INTO public.bands DEFAULT VALUES;",
        "WITH changed AS (DELETE FROM public.bands RETURNING 1) SELECT 1;",
        "SELECT private.fake();",
        "SELECT pg_catalog.pg_sleep(1);",
        "SELECT pg_catalog.pg_get_expr(NULL,NULL);",
        "SELECT pg_catalog.count(*) FROM public.bands;",
        'SELECT "pg_sleep"(1);',
        "SELECT 1 FOR SHARE;",
        "SET LOCAL row_security = on;",
        "SELECT * FROM pg_catalog.pg_authid;",
    ]
    candidates = [texts[0].replace("ROLLBACK;", item + "\nROLLBACK;") for item in mutations]
    candidates += [texts[0].replace("READ ONLY", "READ WRITE"), texts[0].replace("ROLLBACK;", "")]
    for number, candidate in enumerate(candidates, 1):
        try:
            inspect(candidate, 1)
        except AssertionError:
            continue
        raise AssertionError(f"Unsafe mutation accepted: {number}")
    print(f"Negative tests: {len(candidates)} rejected")
    assert "THEN 'unresolved_ipv6'" in texts[1] and "::inet" not in texts[1]
    for size in [0, 1, 1024, 1025, 2047, 2048, 2049, 3000]:
        for text in ["a" * size, "\U0001f3b8" * size, "a" * size + "\U0001f3b8"]:
            full = len(text.encode("utf-16-le")) // 2
            bounded = len(text) + sum(ord(char) > 65535 for char in text[:2048])
            assert (full > 2048) == (bounded > 2048)
    print("UTF-16: 24 offline threshold cases passed; IPv6 remains unresolved")
    print("No SQL parsed/executed; no database, network, subprocess or file writes")


if __name__ == "__main__":
    main()
