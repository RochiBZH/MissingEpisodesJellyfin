using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.MissingEpisodes;

public sealed class CalendarMenuStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.UseMiddleware<CalendarMenuInjectionMiddleware>();
            next(app);
        };
    }
}

public sealed class CalendarMenuInjectionMiddleware
{
    private const string ScriptPath = "/Plugins/MissingEpisodes/calendar-widget.js";
    private const string WidgetResourceName = "Jellyfin.Plugin.MissingEpisodes.Configuration.calendarWidget.js";
    private static readonly Lazy<string> ScriptVersion = new(ComputeScriptVersion);
    private readonly RequestDelegate _next;

    public CalendarMenuInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        if (!IsWebIndexRequest(path))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        context.Request.Headers.Remove("Accept-Encoding");
        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await _next(context).ConfigureAwait(false);
            if (context.Response.StatusCode != StatusCodes.Status200OK
                || !(context.Response.ContentType ?? string.Empty).StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
            {
                await CopyBackAsync(buffer, originalBody).ConfigureAwait(false);
                return;
            }

            buffer.Position = 0;
            using var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
            var html = await reader.ReadToEndAsync().ConfigureAwait(false);
            if (html.Length == 0 || html.Contains(ScriptPath, StringComparison.OrdinalIgnoreCase))
            {
                await CopyBackAsync(buffer, originalBody).ConfigureAwait(false);
                return;
            }

            var bodyIndex = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            if (bodyIndex < 0)
            {
                await CopyBackAsync(buffer, originalBody).ConfigureAwait(false);
                return;
            }

            var basePath = (context.Request.PathBase.Value ?? string.Empty).TrimEnd('/');
            var scriptUrl = HtmlEncoder.Default.Encode(basePath + ScriptPath + "?v=" + ScriptVersion.Value);
            var scriptTag = "\n<script src=\"" + scriptUrl + "\"></script>\n";
            var bytes = Encoding.UTF8.GetBytes(html.Insert(bodyIndex, scriptTag));
            context.Response.Headers.Remove("Content-Length");
            context.Response.ContentLength = bytes.Length;
            await originalBody.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
        }
        finally
        {
            context.Response.Body = originalBody;
        }
    }

    private static async Task CopyBackAsync(MemoryStream buffer, Stream destination)
    {
        if (buffer.Length == 0) return;
        buffer.Position = 0;
        await buffer.CopyToAsync(destination).ConfigureAwait(false);
    }

    private static bool IsWebIndexRequest(string path)
    {
        return path.Equals("/", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/web", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/web/", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase);
    }

    private static string ComputeScriptVersion()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(WidgetResourceName);
        if (stream is null) return "0";

        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(stream);
        return Convert.ToHexString(hash, 0, 4).ToLowerInvariant();
    }
}
