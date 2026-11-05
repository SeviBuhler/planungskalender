-- Finanzplan: Einnahmen sind neu eine Liste von Positionen (Bezeichnung, Betrag) wie die Ausgaben.
-- Die bisherige einzelne Einnahme eines Monats wird zur Position «Einnahme»; Monate ohne
-- Einnahme bekommen eine leere Liste.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

update public.month_budgets
set data = (data - 'income') || jsonb_build_object(
    'incomes',
    case
        when coalesce((data ->> 'income')::numeric, 0) <> 0
            then jsonb_build_array(jsonb_build_object('name', 'Einnahme', 'amount', (data ->> 'income')::numeric))
        else '[]'::jsonb
    end
)
where not data ? 'incomes';
