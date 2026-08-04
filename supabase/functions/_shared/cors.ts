// Cabeçalhos CORS compartilhados entre as funções (úteis se algo for chamado
// direto do navegador; o webhook em si é chamado pelo servidor do Meta).
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sched-key",
};
