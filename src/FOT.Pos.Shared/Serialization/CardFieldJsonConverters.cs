using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FOT.Pos.Shared.Serialization;

/// <summary>
/// The card terminal service reports receipt fields with whatever type its firmware uses —
/// batch/ref numbers arrive as JSON numbers on some readers and as strings on others. A strict
/// bind throws before the endpoint runs, which the terminal can only see as an empty 400, so the
/// already-charged sale is dropped as a permanent failure. Reading any scalar as text keeps the
/// sale saveable regardless of the reader's firmware.
/// </summary>
public sealed class LenientStringJsonConverter : JsonConverter<string?>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.Null:
                return null;
            case JsonTokenType.String:
                var text = reader.GetString();
                return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
            case JsonTokenType.Number:
                if (reader.TryGetInt64(out var l)) return l.ToString(CultureInfo.InvariantCulture);
                return reader.TryGetDecimal(out var d)
                    ? d.ToString(CultureInfo.InvariantCulture)
                    : null;
            case JsonTokenType.True:
                return "true";
            case JsonTokenType.False:
                return "false";
            default:
                reader.Skip();
                return null;
        }
    }

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value);
    }
}

/// <summary>
/// Card readers stamp the transaction time in local device formats such as yyyyMMddHHmmss,
/// which are not ISO-8601 and would fail a strict bind. The timestamp is informational on the
/// receipt, so an unreadable value becomes null instead of rejecting a charged sale.
/// </summary>
public sealed class LenientDateTimeJsonConverter : JsonConverter<DateTime?>
{
    private static readonly string[] Formats =
    [
        "yyyyMMddHHmmss",
        "yyyyMMddHHmm",
        "yyMMddHHmmss",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy/MM/dd HH:mm:ss",
        "dd/MM/yyyy HH:mm:ss",
        "MM/dd/yyyy HH:mm:ss",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyyMMdd",
    ];

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;

        if (reader.TokenType == JsonTokenType.Number)
        {
            if (!reader.TryGetInt64(out var epoch)) return null;
            return FromNumber(epoch);
        }

        if (reader.TokenType != JsonTokenType.String)
        {
            reader.Skip();
            return null;
        }

        if (reader.TryGetDateTime(out var native)) return native;

        var raw = reader.GetString()?.Trim();
        if (string.IsNullOrEmpty(raw)) return null;

        if (DateTime.TryParseExact(raw, Formats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var exact))
            return exact;

        if (DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var loose))
            return loose;

        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var digits)
            ? FromNumber(digits)
            : null;
    }

    private static DateTime? FromNumber(long value)
    {
        var text = value.ToString(CultureInfo.InvariantCulture);
        if (DateTime.TryParseExact(text, Formats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var stamped))
            return stamped;
        try
        {
            // Epoch seconds vs milliseconds — readers use both.
            return value > 99_999_999_999L
                ? DateTimeOffset.FromUnixTimeMilliseconds(value).LocalDateTime
                : DateTimeOffset.FromUnixTimeSeconds(value).LocalDateTime;
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value);
    }
}
