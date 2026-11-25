/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! JSON printed as `JSON.stringify(value, undefined, "\t")` prints it, which is
//! how `conf` writes a store file (`specs/007-main-foundation/contracts/store-format.md`).

use serde_json::{Map, Number, Value};

/// The text of `value` with the bytes the Electron build writes: a tab per
/// level, array-index keys first, numbers as JavaScript prints them, and no
/// newline at the end.
pub fn to_js_string(value: &Value) -> String {
    to_js_string_indented(value, "\t")
}

/// `JSON.stringify(value, undefined, indent)`.
pub fn to_js_string_indented(value: &Value, indent: &str) -> String {
    let mut out = String::new();
    write_value(&mut out, value, 0, indent);
    out
}

/// Removes `key` and keeps the order of the other keys, as `delete` does in
/// JavaScript; `Map::remove` would move the last key into its place.
pub fn remove_key(map: &mut Map<String, Value>, key: &str) -> Option<Value> {
    map.shift_remove(key)
}

fn write_value(out: &mut String, value: &Value, depth: usize, unit: &str) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&js_number(number)),
        Value::String(text) => write_string(out, text),
        Value::Array(items) if items.is_empty() => out.push_str("[]"),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                out.push_str(if index == 0 { "\n" } else { ",\n" });
                indent(out, depth + 1, unit);
                write_value(out, item, depth + 1, unit);
            }
            out.push('\n');
            indent(out, depth, unit);
            out.push(']');
        }
        Value::Object(map) if map.is_empty() => out.push_str("{}"),
        Value::Object(map) => {
            out.push('{');
            for (index, (key, item)) in js_key_order(map).into_iter().enumerate() {
                out.push_str(if index == 0 { "\n" } else { ",\n" });
                indent(out, depth + 1, unit);
                write_string(out, key);
                out.push_str(": ");
                write_value(out, item, depth + 1, unit);
            }
            out.push('\n');
            indent(out, depth, unit);
            out.push('}');
        }
    }
}

fn indent(out: &mut String, depth: usize, unit: &str) {
    for _ in 0..depth {
        out.push_str(unit);
    }
}

/// The keys in the order JavaScript enumerates them: array indices first,
/// ascending, then the others as they were added.
fn js_key_order(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut indices: Vec<(u32, (&String, &Value))> = Vec::new();
    let mut others = Vec::new();
    for entry in map {
        match array_index(entry.0) {
            Some(index) => indices.push((index, entry)),
            None => others.push(entry),
        }
    }
    indices.sort_by_key(|(index, _)| *index);
    indices
        .into_iter()
        .map(|(_, entry)| entry)
        .chain(others)
        .collect()
}

/// An array index is a canonical decimal integer below 2^32 - 1.
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    if !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    key.parse::<u32>().ok().filter(|index| *index < u32::MAX)
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if control < ' ' => out.push_str(&format!("\\u{:04x}", control as u32)),
            other => out.push(other),
        }
    }
    out.push('"');
}

/// `Number.prototype.toString` of the double JavaScript reads the number as.
fn js_number(number: &Number) -> String {
    const SAFE: u64 = 1 << 53;
    if let Some(value) = number.as_u64().filter(|value| *value <= SAFE) {
        return value.to_string();
    }
    if let Some(value) = number.as_i64().filter(|value| value.unsigned_abs() <= SAFE) {
        return value.to_string();
    }
    // u64 and i64 beyond 2^53 become the nearest double, as JSON.parse reads them.
    js_double(number.as_f64().unwrap_or(f64::NAN))
}

fn js_double(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    if !value.is_finite() {
        // JSON.stringify prints what is not finite as null; serde_json never holds it.
        return "null".into();
    }
    // `{:e}` gives the shortest digits that read back as the same double.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("{:e} has an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    let n = exponent
        .parse::<i32>()
        .expect("{:e} has a decimal exponent")
        + 1;
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let exponent = n - 1;
        let sign = if exponent < 0 { "-" } else { "+" };
        match digits.split_at(1) {
            (first, "") => format!("{first}e{sign}{}", exponent.abs()),
            (first, rest) => format!("{first}.{rest}e{sign}{}", exponent.abs()),
        }
    };
    format!("{sign}{body}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn indents_with_tabs_and_ends_without_a_newline() {
        let value = json!({"a": {"b": [1, {"c": true}]}, "d": null});
        assert_eq!(
            to_js_string(&value),
            "{\n\t\"a\": {\n\t\t\"b\": [\n\t\t\t1,\n\t\t\t{\n\t\t\t\t\"c\": true\n\t\t\t}\n\t\t]\n\t},\n\t\"d\": null\n}"
        );
    }

    #[test]
    fn prints_empty_objects_and_arrays_on_one_line() {
        let value = json!({"a": {}, "b": []});
        assert_eq!(to_js_string(&value), "{\n\t\"a\": {},\n\t\"b\": []\n}");
        assert_eq!(to_js_string(&json!({})), "{}");
        assert_eq!(to_js_string(&json!([])), "[]");
    }

    #[test]
    fn puts_array_index_keys_first_in_ascending_order() {
        let value = parse(
            r#"{"b": 1, "10": 2, "a": 3, "2": 4, "01": 5, "4294967295": 6, "4294967294": 7}"#,
        );
        assert_eq!(
            to_js_string(&value),
            "{\n\t\"2\": 4,\n\t\"10\": 2,\n\t\"4294967294\": 7,\n\t\"b\": 1,\n\t\"a\": 3,\n\t\"01\": 5,\n\t\"4294967295\": 6\n}"
        );
    }

    #[test]
    fn keeps_the_order_of_other_keys_as_they_were_added() {
        let mut map = Map::new();
        map.insert("z".into(), json!(1));
        map.insert("a".into(), json!(2));
        map.insert("m".into(), json!(3));
        assert_eq!(
            to_js_string(&Value::Object(map)),
            "{\n\t\"z\": 1,\n\t\"a\": 2,\n\t\"m\": 3\n}"
        );
    }

    #[test]
    fn prints_numbers_as_javascript_does() {
        let cases = [
            ("0", "0"),
            ("-0", "0"),
            ("-0.0", "0"),
            ("12", "12"),
            ("-12", "-12"),
            ("0.1", "0.1"),
            ("1.5", "1.5"),
            ("100.0", "100"),
            ("1e21", "1e+21"),
            ("1e20", "100000000000000000000"),
            ("123456789012345680000", "123456789012345680000"),
            ("1e-7", "1e-7"),
            ("0.000001", "0.000001"),
            ("1.25e-7", "1.25e-7"),
            ("2.5e25", "2.5e+25"),
            ("9007199254740993", "9007199254740992"),
            ("12345678901234567890", "12345678901234567000"),
            ("-9223372036854775808", "-9223372036854776000"),
        ];
        for (input, expected) in cases {
            assert_eq!(to_js_string(&parse(input)), expected, "for {input}");
        }
    }

    #[test]
    fn escapes_strings_as_javascript_does() {
        let value = Value::String("q\" s\\ \u{8}\u{c}\n\r\t \u{1} \u{1f} é 日 \u{2028} /".into());
        assert_eq!(
            to_js_string(&value),
            "\"q\\\" s\\\\ \\b\\f\\n\\r\\t \\u0001 \\u001f é 日 \u{2028} /\""
        );
    }

    #[test]
    fn indents_with_what_it_is_given() {
        assert_eq!(
            to_js_string_indented(&json!({"a": [1]}), "  "),
            "{\n  \"a\": [\n    1\n  ]\n}"
        );
    }

    #[test]
    fn removes_a_key_and_keeps_the_order_of_the_others() {
        let Value::Object(mut map) = parse(r#"{"a": 1, "b": 2, "c": 3, "d": 4}"#) else {
            unreachable!()
        };
        assert_eq!(remove_key(&mut map, "b"), Some(json!(2)));
        assert_eq!(remove_key(&mut map, "x"), None);
        let keys: Vec<_> = map.keys().cloned().collect();
        assert_eq!(keys, ["a", "c", "d"]);
    }
}
