// Fixture for natscodegen-definition-error (rule in csharp.yml, path-scoped to NatsCodeGen's cli/).
// opengrep --test pairs fixtures by name, so this file only checks the rule's patterns.
class Loader
{
    void Check(Definition d)
    {
        if (d.Name == null)
            // ruleid: natscodegen-definition-error
            throw new InvalidOperationException("definition has no name");
        if (d.Fields.Count == 0)
            // ok: natscodegen-definition-error
            throw new DefinitionValidationException(d, "definition has no fields");
    }
}
