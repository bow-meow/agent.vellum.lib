// Fixture for csharp.yml: "ruleid:" lines must match, "ok:" lines must not. opengrep scan --test rules/
using System;
using System.Data.SqlClient;
using System.IO;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

class Fixture : Form
{
    static readonly HttpClient Shared = new HttpClient();
    private HttpClient _client;

    // ruleid: async-void-not-event-handler
    private async void UploadUsers(string name)
    {
        await Task.Delay(1);
    }

    // ok: async-void-not-event-handler
    private async void OnClick(object sender, EventArgs e)
    {
        await Task.Delay(1);
    }

    // ok: async-void-not-event-handler
    protected override async void OnLoad(EventArgs e)
    {
        await Task.Delay(1);
    }

    // ok: async-void-not-event-handler
    private async Task Save()
    {
        await Task.Delay(1);
    }

    void Rethrow()
    {
        try { Work(); }
        catch (IOException ex)
        {
            Log(ex);
            // ruleid: throw-caught-exception-variable
            throw ex;
        }
        try { Work(); }
        catch (IOException ex)
        {
            // ok: throw-caught-exception-variable
            throw;
        }
        try { Work(); }
        catch (IOException ex)
        {
            // ok: throw-caught-exception-variable
            throw new InvalidOperationException("wrapped", ex);
        }
    }

    async Task<string> Fetch(string url)
    {
        // ruleid: httpclient-per-call
        using (var client = new HttpClient())
        {
            return await client.GetStringAsync(url);
        }
    }

    async Task<string> FetchShared(string url)
    {
        // ok: httpclient-per-call
        return await Shared.GetStringAsync(url);
    }

    Fixture()
    {
        // ok: httpclient-per-call
        _client = new HttpClient();
    }

    void Swallow()
    {
        // ruleid: empty-catch
        try { Work(); }
        catch (IOException ex) { }
        // ruleid: empty-catch
        try { Work(); }
        catch { }
        // ok: empty-catch
        try { Work(); }
        catch (IOException ex) { Log(ex); }
    }

    bool Validate(string value)
    {
        // ruleid: regex-dollar-anchor
        var a = Regex.IsMatch(value, "^[A-Z]+$");
        // ruleid: regex-dollar-anchor
        var r = new Regex(@"^\d{4}$");
        // ok: regex-dollar-anchor
        var b = Regex.IsMatch(value, @"^[A-Z]+\z");
        // ok: regex-dollar-anchor
        var c = Regex.IsMatch(value, @"^cost\$");
        // ok: regex-dollar-anchor
        var plural = new Regex("(?<keep>[^aeiou])ies$");
        return a && b && c;
    }

    void Block(Task task, Task<int> countTask, Response response)
    {
        // ruleid: blocking-on-task
        task.Wait();
        // ruleid: blocking-on-task
        var n = countTask.Result;
        // ruleid: blocking-on-task
        var s = LoadAsync().GetAwaiter().GetResult();
        // ruleid: blocking-on-task
        var t = LoadAsync().Result;
        // ok: blocking-on-task
        var id = response.Result.Id;
    }

    void Disposables(string cs)
    {
        // ruleid: disposable-without-using
        SqlConnection conn = new SqlConnection(cs);
        conn.Open();
        // ok: disposable-without-using
        using (SqlCommand cmd = new SqlCommand("select 1"))
        {
            cmd.ExecuteNonQuery();
        }
        // ok: disposable-without-using
        var ms = new MemoryStream();
        ms.Write(new byte[1], 0, 1);
        ms.Dispose();
    }

    MemoryStream Owned()
    {
        // ok: disposable-without-using
        var ms = new MemoryStream();
        return ms;
    }

    void Times()
    {
        // ruleid: datetime-now
        var when = DateTime.Now;
        // ok: datetime-now
        var utc = DateTime.UtcNow;
    }

    void Subscribe(Publisher p)
    {
        // ruleid: lambda-event-subscription
        p.Changed += (s, e) => Refresh();
        // ok: lambda-event-subscription
        p.Changed += OnChanged;
    }

    void Fire()
    {
        // ruleid: fire-and-forget-task
        _ = SendAsync();
        // ruleid: fire-and-forget-task
        Task.Run(() => Work());
        // ok: fire-and-forget-task
        var pending = Task.Run(() => Work());
    }

    void Swap(string staged, string target)
    {
        try
        {
            // ruleid: file-replace-then-cleanup
            File.Replace(staged, target, null);
        }
        finally
        {
            File.Delete(staged);
        }
    }
}

class MoreFixture
{
    void Sql(SqlConnection conn, string name, int id, Db db)
    {
        // ruleid: sql-built-from-strings
        var a = new SqlCommand("SELECT * FROM Card WHERE Name = '" + name + "'", conn);
        // ruleid: sql-built-from-strings
        var b = new SqlCommand($"SELECT * FROM Card WHERE Id = {id}", conn);
        var c = new SqlCommand();
        // ruleid: sql-built-from-strings
        c.CommandText = string.Format("DELETE FROM Card WHERE Id = {0}", id);
        // ruleid: sql-built-from-strings
        db.Database.ExecuteSqlRaw($"UPDATE Card SET Name = '{name}'");
        // ok: sql-built-from-strings
        var d = new SqlCommand("SELECT * FROM Card WHERE Name = @name", conn);
        // ok: sql-built-from-strings
        var e = new SqlCommand("SELECT * FROM Card " + "WHERE Name = @name", conn);
        // ok: sql-built-from-strings
        db.Cards.FromSqlInterpolated($"SELECT * FROM Card WHERE Id = {id}");
    }

    void Logging(ILoggingBuilder builder)
    {
        // ruleid: logging-formatter-named-overload
        builder.AddSimpleConsole(o => o.SingleLine = true);
        // ok: logging-formatter-named-overload
        builder.AddConsole();
    }

    bool Compare(string a, string b)
    {
        // ruleid: culture-case-comparison
        var x = a.ToLower() == b;
        // ruleid: culture-case-comparison
        var y = string.Equals(a, b);
        // ok: culture-case-comparison
        var z = string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        return x && y && z;
    }

    bool Counts(IQueryable<Card> cards, List<Card> list)
    {
        // ruleid: count-compared-with-zero
        var any = cards.Count() > 0;
        // ok: count-compared-with-zero
        var some = list.Count > 0;
        // ok: count-compared-with-zero
        var other = cards.Any();
        return any && some && other;
    }

    async Task Timeouts(Task<string> work, HttpClient client, CancellationToken ct)
    {
        // ruleid: whenany-delay-timeout
        var first = await Task.WhenAny(work, Task.Delay(5000));
        // ruleid: whenany-delay-timeout
        var text = await work.WaitAsync(TimeSpan.FromSeconds(5));
        // ok: whenany-delay-timeout
        var body = await client.GetStringAsync("http://x", ct);
        var tcs = new TaskCompletionSource<bool>();
        // ok: whenany-delay-timeout
        var notified = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(3));
        // ok: whenany-delay-timeout
        await m_signal.WaitAsync(cancellationToken);
    }
}
