using System.Text.Json;
using System.Text.Json.Serialization;

namespace FOT.Pos.Shared.Serialization;

/// <summary>
/// Stores classic receipt style as JSON text in SQL, but exposes an object on the API.
/// Accepts either a JSON object or a JSON string from older clients.
/// </summary>
public sealed class ClassicStyleJsonConverter : JsonConverter<string?>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.String)
        {
            var text = reader.GetString();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        if (reader.TokenType == JsonTokenType.StartObject)
        {
            using var doc = JsonDocument.ParseValue(ref reader);
            var raw = doc.RootElement.GetRawText();
            return raw is "{}" or "null" ? null : raw;
        }
        reader.Skip();
        return null;
    }

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            writer.WriteNullValue();
            return;
        }
        try
        {
            using var doc = JsonDocument.Parse(value);
            doc.RootElement.WriteTo(writer);
        }
        catch (JsonException)
        {
            writer.WriteNullValue();
        }
    }
}
