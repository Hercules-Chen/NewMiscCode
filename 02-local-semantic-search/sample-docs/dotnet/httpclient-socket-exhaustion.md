# HttpClient socket exhaustion

Creating a new `HttpClient` per request and disposing it leaves sockets in `TIME_WAIT`;
under load the machine runs out of ephemeral ports and requests start failing with
`SocketException: Only one usage of each socket address is normally permitted`.

## Fix

- Reuse a single static `HttpClient`, or use `IHttpClientFactory` in ASP.NET Core.
- Set `SocketsHttpHandler.PooledConnectionLifetime` (e.g. 2 minutes) so DNS changes are honoured.

```csharp
static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) });
```
