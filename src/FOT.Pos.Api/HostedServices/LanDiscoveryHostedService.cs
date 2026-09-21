using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using FOT.Pos.Api.Lan;

namespace FOT.Pos.Api.HostedServices;

public sealed class LanDiscoveryHostedService(ILogger<LanDiscoveryHostedService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            LanFirewall.Ensure();
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "LAN firewall rules could not be verified");
        }

        UdpClient? listener = null;
        try
        {
            listener = new UdpClient(AddressFamily.InterNetwork);
            listener.EnableBroadcast = true;
            listener.ExclusiveAddressUse = false;
            listener.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            listener.Client.Bind(new IPEndPoint(IPAddress.Any, LanNetwork.DiscoveryPort));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "LAN discovery UDP {Port} could not bind — secondary PCs can still type the API URL", LanNetwork.DiscoveryPort);
            listener?.Dispose();
            return;
        }

        using (listener)
        {
            logger.LogInformation("LAN discovery listening on UDP {Port}", LanNetwork.DiscoveryPort);
            var reply = ReplyLoop(listener, stoppingToken);
            var beacon = BeaconLoop(stoppingToken);
            await Task.WhenAll(reply, beacon);
        }
    }

    private async Task ReplyLoop(UdpClient udp, CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = await udp.ReceiveAsync(stoppingToken);
                var text = Encoding.UTF8.GetString(result.Buffer).Trim();
                if (!text.StartsWith(LanNetwork.ProbeMagic, StringComparison.Ordinal)) continue;
                await udp.SendAsync(EncodeBeacon(), result.RemoteEndPoint, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "LAN discovery reply failed");
                try { await Task.Delay(250, stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            }
        }
    }

    private async Task BeaconLoop(CancellationToken stoppingToken)
    {
        using var sender = new UdpClient(AddressFamily.InterNetwork);
        sender.EnableBroadcast = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var payload = EncodeBeacon();
                foreach (var host in LanNetwork.BroadcastAddresses())
                {
                    try
                    {
                        await sender.SendAsync(payload, new IPEndPoint(IPAddress.Parse(host), LanNetwork.DiscoveryPort), stoppingToken);
                    }
                    catch (SocketException)
                    {
                        /* adapter may be down */
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogDebug(ex, "LAN discovery beacon failed");
            }

            try { await Task.Delay(TimeSpan.FromSeconds(2.5), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    private static byte[] EncodeBeacon()
    {
        var ips = LanNetwork.ListPriceCheckerIpv4Addresses();
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            app = LanNetwork.AppId,
            hostName = Environment.MachineName,
            port = LanNetwork.ApiPort,
            urls = LanNetwork.ApiUrls(ips)
        }, JsonOptions));
    }
}
