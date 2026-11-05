-- Finanzplan: Die erste Position heisst «Übertrag Vormonat» und wird aus dem Saldo des
-- Vormonats berechnet. Manuell gesetzte Werte stehen in data.carryOverride (null = berechnet).
-- Bisher eingegebene Startguthaben: der erste gespeicherte Monat eines Plans behält seinen
-- Wert als manuellen Übertrag (er hat keinen Vormonat), alle späteren Monate rechnen neu.
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

update public.month_budgets b
set data = b.data || jsonb_build_object(
    'carryOverride',
    case
        when b.month = f.first_month and coalesce((b.data ->> 'startBalance')::numeric, 0) <> 0
            then b.data -> 'startBalance'
        else 'null'::jsonb
    end
)
from (select plan_id, min(month) as first_month from public.month_budgets group by plan_id) f
where f.plan_id = b.plan_id
  and not b.data ? 'carryOverride';
