# Route import

Use **Import from log** to select a completed run and prepare a route. The importer matches recorded enemies to current placements, accounts for supported summons and replacements, and reconstructs supported route actions. Imported routes require a compatible game build.

When several routes fit the available evidence, review the alternatives before saving. Recoverable omissions are shown together for explicit acceptance. Missing positions, ambiguous floors, incomplete events and unsupported identities can prevent an exact reconstruction. Cancelling discards the prepared import.

Priority targets are selected manually in the enemy context menu. Manual flags are saved, synchronized and exported with the route.

Implementation lives in `log-import/`. Run the relevant import tests after changing matching, summon classification, route actions or recovery behavior.
