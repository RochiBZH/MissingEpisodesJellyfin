using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.MissingEpisodes.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.MissingEpisodes.Api;

[ApiController]
[Route("Plugins/MissingEpisodes")]
public sealed class CalendarController : ControllerBase
{
    private readonly MissingEpisodesService _service;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly IAuthorizationContext _authorizationContext;

    public CalendarController(
        MissingEpisodesService service,
        ILibraryManager libraryManager,
        IUserManager userManager,
        IAuthorizationContext authorizationContext)
    {
        _service = service;
        _libraryManager = libraryManager;
        _userManager = userManager;
        _authorizationContext = authorizationContext;
    }

    [HttpGet("calendar")]
    [Authorize]
    [ProducesResponseType(typeof(UserCalendarData), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<UserCalendarData>> GetCalendar(CancellationToken cancellationToken)
    {
        var authorizationInfo = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        if (authorizationInfo?.UserId is not Guid userId || userId == Guid.Empty)
        {
            return Unauthorized();
        }

        var user = _userManager.GetUserById(userId);
        if (user is null)
        {
            return Unauthorized();
        }

        var userDto = _userManager.GetUserDto(
            user,
            HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty);
        var isAdministrator = userDto.Policy.IsAdministrator;

        var visibleSeries = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = new[] { BaseItemKind.Series },
            Recursive = true
        }).OfType<Series>().ToList();

        var visibleById = visibleSeries.ToDictionary(
            series => series.Id.ToString("N"),
            StringComparer.OrdinalIgnoreCase);
        var visibleByTvdb = new Dictionary<int, Series>();
        foreach (var series in visibleSeries)
        {
            var tvdbId = series.GetProviderId(MediaBrowser.Model.Entities.MetadataProvider.Tvdb);
            if (int.TryParse(tvdbId, out var parsedId) && parsedId > 0)
            {
                visibleByTvdb.TryAdd(parsedId, series);
            }
        }

        var lastResult = _service.LastResult;
        if (lastResult is null)
        {
            return Ok(new UserCalendarData { IsAdministrator = isAdministrator });
        }

        return Ok(new UserCalendarData
        {
            IsAdministrator = isAdministrator,
            Series = ProjectVisibleSeries(lastResult.Series, visibleById, visibleByTvdb),
            IgnoredSeries = ProjectVisibleSeries(lastResult.IgnoredSeries, visibleById, visibleByTvdb)
        });
    }

    [HttpGet("calendar-widget.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult GetCalendarWidget()
    {
        const string resourceName = "Jellyfin.Plugin.MissingEpisodes.Configuration.calendarWidget.js";
        var stream = typeof(CalendarController).Assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers.CacheControl = "no-cache";
        return File(stream, "application/javascript; charset=utf-8");
    }

    private static List<UserCalendarSeries> ProjectVisibleSeries(
        IEnumerable<ScanSeries> source,
        IReadOnlyDictionary<string, Series> visibleById,
        IReadOnlyDictionary<int, Series> visibleByTvdb)
    {
        var result = new List<UserCalendarSeries>();
        foreach (var scanSeries in source)
        {
            Series? librarySeries = null;
            if (Guid.TryParse(scanSeries.JellyfinSeriesId, out var jellyfinId))
            {
                visibleById.TryGetValue(jellyfinId.ToString("N"), out librarySeries);
            }
            if (librarySeries is null && scanSeries.TvdbId > 0)
            {
                visibleByTvdb.TryGetValue(scanSeries.TvdbId, out librarySeries);
            }
            if (librarySeries is null)
            {
                continue;
            }

            result.Add(new UserCalendarSeries
            {
                Title = librarySeries.Name,
                SeriesType = scanSeries.SeriesType,
                PosterUrl = "jellyfin:" + librarySeries.Id.ToString("N"),
                Seasons = (scanSeries.Seasons ?? new List<SeasonSummary>())
                    .Select(season => new UserCalendarSeason
                    {
                        SeasonNumber = season.SeasonNumber,
                        TotalEpisodes = season.TotalEpisodes
                    }).ToList(),
                Missing = (scanSeries.Missing ?? new List<MissingEpisode>())
                    .Where(episode => episode.AirDateUtc.HasValue)
                    .Select(episode => new UserCalendarEpisode
                    {
                        SeasonNumber = episode.SeasonNumber,
                        EpisodeNumber = episode.EpisodeNumber,
                        Title = episode.Title,
                        AirDateUtc = episode.AirDateUtc
                    }).ToList()
            });
        }

        return result;
    }
}

public sealed class UserCalendarData
{
    public bool IsAdministrator { get; init; }
    public List<UserCalendarSeries> Series { get; init; } = new();
    public List<UserCalendarSeries> IgnoredSeries { get; init; } = new();
}

public sealed class UserCalendarSeries
{
    public string Title { get; init; } = string.Empty;
    public string SeriesType { get; init; } = "standard";
    public string? PosterUrl { get; init; }
    public List<UserCalendarSeason> Seasons { get; init; } = new();
    public List<UserCalendarEpisode> Missing { get; init; } = new();
}

public sealed class UserCalendarSeason
{
    public int SeasonNumber { get; init; }
    public int TotalEpisodes { get; init; }
}

public sealed class UserCalendarEpisode
{
    public int SeasonNumber { get; init; }
    public int EpisodeNumber { get; init; }
    public string? Title { get; init; }
    public DateTime? AirDateUtc { get; init; }
}
