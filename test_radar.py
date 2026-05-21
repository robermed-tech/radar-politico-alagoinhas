"""
Suite de testes unitários para radar.py
Cobre: utilitários, validação de schema, lógica de filtro, cache de perfis.
Não faz chamadas reais a APIs (Claude, Apify, Google Sheets).
"""
import json
import sys
import unittest
from unittest.mock import MagicMock, patch, call
import os

# Stub das variáveis de ambiente antes de importar radar
os.environ.setdefault("APIFY_API_TOKEN",          "TEST_APIFY_TOKEN")
os.environ.setdefault("APIFY_DATASET_ID",         "TEST_DATASET_ID")
os.environ.setdefault("ANTHROPIC_API_KEY",        "TEST_ANTHROPIC_KEY")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json")
os.environ.setdefault("GOOGLE_SHEET_ID",          "TEST_SHEET_ID")

import radar  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# 1. Utilitários
# ─────────────────────────────────────────────────────────────────────────────

class TestCleanText(unittest.TestCase):
    def test_none_returns_empty(self):
        self.assertEqual(radar.clean_text(None), "")

    def test_empty_returns_empty(self):
        self.assertEqual(radar.clean_text(""), "")

    def test_strips_whitespace(self):
        self.assertEqual(radar.clean_text("  hello  "), "hello")

    def test_replaces_newlines(self):
        result = radar.clean_text("line1\nline2\r\nline3")
        self.assertNotIn("\n", result)
        self.assertNotIn("\r", result)

    def test_collapses_spaces(self):
        result = radar.clean_text("a    b    c")
        self.assertEqual(result, "a b c")

    def test_replaces_double_quotes(self):
        result = radar.clean_text('say "hello"')
        self.assertNotIn('"', result)
        self.assertIn("'", result)


class TestFormatDate(unittest.TestCase):
    def test_iso_z_format(self):
        result = radar.format_date("2026-05-17T13:37:34.000Z")
        self.assertEqual(result, "17/05/2026 13:37")

    def test_empty_string(self):
        self.assertEqual(radar.format_date(""), "")

    def test_none(self):
        self.assertEqual(radar.format_date(None), "")

    def test_invalid_falls_back_to_prefix(self):
        # Uma string que não é ISO válida aciona o fallback de prefixo (16 chars)
        result = radar.format_date("05/17/2026 INVALID-DATE")
        self.assertEqual(result, "05/17/2026 INVAL")


class TestExtractUsernameFromUrl(unittest.TestCase):
    def test_standard_post_url(self):
        url = "https://www.instagram.com/gustavoascarmo/p/ABC123/"
        self.assertEqual(radar.extract_username_from_url(url), "gustavoascarmo")

    def test_returns_lowercase(self):
        url = "https://www.instagram.com/GustavoAsCarmo/p/ABC123/"
        self.assertEqual(radar.extract_username_from_url(url), "gustavoascarmo")

    def test_no_match_returns_empty(self):
        self.assertEqual(radar.extract_username_from_url("https://instagram.com/p/ABC/"), "")

    def test_none_returns_empty(self):
        self.assertEqual(radar.extract_username_from_url(None), "")


class TestExtractComments(unittest.TestCase):
    def _item(self, latest=None, first=None, top=None):
        return {
            "latestComments": latest or [],
            "firstComment": first or "",
            "topComment": top or "",
        }

    def test_extracts_latest_comments(self):
        # clean_text normaliza espaços e aspas, mas preserva acentos
        item = self._item(latest=[{"text": "Ótimo trabalho!"}, {"text": "Parabéns"}])
        result = radar.extract_comments(item)
        self.assertEqual(result, ["Ótimo trabalho!", "Parabéns"])

    def test_falls_back_to_first_comment(self):
        # clean_text preserva acentos; apenas normaliza espaços e aspas
        item = self._item(first="Comentário único")
        result = radar.extract_comments(item)
        self.assertIn("Comentário único", result[0])

    def test_caps_at_15_comments(self):
        item = self._item(latest=[{"text": f"c{i}"} for i in range(20)])
        result = radar.extract_comments(item)
        self.assertEqual(len(result), 15)

    def test_deduplicates(self):
        item = self._item(latest=[{"text": "dup"}, {"text": "dup"}, {"text": "único"}])
        result = radar.extract_comments(item)
        self.assertEqual(result.count("dup"), 1)

    def test_empty_item_returns_empty(self):
        result = radar.extract_comments({})
        self.assertEqual(result, [])


class TestBuildCommentsBlock(unittest.TestCase):
    def test_no_comments(self):
        result = radar.build_comments_block([])
        self.assertIn("nenhum", result)

    def test_numbered_lines(self):
        result = radar.build_comments_block(["A", "B"])
        self.assertIn("1. A", result)
        self.assertIn("2. B", result)

    def test_truncates_long_comments(self):
        long = "x" * 300
        result = radar.build_comments_block([long])
        self.assertLessEqual(len(result.split("1. ")[1]), 255)  # 250 + "…"


# ─────────────────────────────────────────────────────────────────────────────
# 2. calc_temperatura
# ─────────────────────────────────────────────────────────────────────────────

class TestCalcTemperatura(unittest.TestCase):
    def test_zero_total(self):
        self.assertEqual(radar.calc_temperatura(0, 0), "baixa")

    def test_baixa(self):
        self.assertEqual(radar.calc_temperatura(1, 10), "baixa")   # 10%

    def test_moderada(self):
        self.assertEqual(radar.calc_temperatura(3, 10), "moderada")  # 30%

    def test_alta(self):
        self.assertEqual(radar.calc_temperatura(5, 10), "alta")    # 50%

    def test_critica(self):
        self.assertEqual(radar.calc_temperatura(7, 10), "critica")  # 70%

    def test_boundary_20pct(self):
        # exactly 20% → moderada (pct >= 0.2)
        self.assertEqual(radar.calc_temperatura(2, 10), "moderada")

    def test_boundary_40pct(self):
        self.assertEqual(radar.calc_temperatura(4, 10), "alta")

    def test_boundary_60pct(self):
        self.assertEqual(radar.calc_temperatura(6, 10), "critica")


# ─────────────────────────────────────────────────────────────────────────────
# 3. validate_analysis
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateAnalysis(unittest.TestCase):
    def _base(self):
        return {
            "relevante": True,
            "sentimento_post": "positivo",
            "sentimento_comentarios": "neutro",
            "categoria_tematica": "saude",
            "tema": "falta de médicos",
            "atribuicao": "secretaria_saude",
            "intensidade": "moderada",
            "urgencia": "alta",
            "localizacao": "Centro",
            "resumo": "Post sobre saúde.",
        }

    def test_valid_analysis_passes_through(self):
        a = self._base()
        result = radar.validate_analysis(a)
        self.assertEqual(result["categoria_tematica"], "saude")
        self.assertEqual(result["atribuicao"], "secretaria_saude")

    def test_irrelevante_skips_validation(self):
        a = {"relevante": False}
        result = radar.validate_analysis(a)
        self.assertFalse(result["relevante"])

    def test_invalid_categoria_defaults_to_imagem_gestao(self):
        a = self._base()
        a["categoria_tematica"] = "esporte_radical"   # não existe no enum
        result = radar.validate_analysis(a)
        self.assertEqual(result["categoria_tematica"], "imagem_gestao")

    def test_invalid_atribuicao_defaults_to_indefinido(self):
        a = self._base()
        a["atribuicao"] = "secretaria_inexistente"
        result = radar.validate_analysis(a)
        self.assertEqual(result["atribuicao"], "indefinido")

    def test_invalid_urgencia_defaults_to_baixa(self):
        a = self._base()
        a["urgencia"] = "urgentissima"
        result = radar.validate_analysis(a)
        self.assertEqual(result["urgencia"], "baixa")

    def test_invalid_intensidade_defaults_to_leve(self):
        a = self._base()
        a["intensidade"] = "explosiva"
        result = radar.validate_analysis(a)
        self.assertEqual(result["intensidade"], "leve")

    def test_invalid_sentimento_post_defaults_to_neutro(self):
        a = self._base()
        a["sentimento_post"] = "incerto"
        result = radar.validate_analysis(a)
        self.assertEqual(result["sentimento_post"], "neutro")

    def test_case_insensitive_normalization(self):
        a = self._base()
        a["urgencia"] = "ALTA"
        result = radar.validate_analysis(a)
        self.assertEqual(result["urgencia"], "alta")

    def test_whitespace_stripped(self):
        a = self._base()
        a["intensidade"] = "  alta  "
        result = radar.validate_analysis(a)
        self.assertEqual(result["intensidade"], "alta")

    def test_misto_is_valid_sentimento_comentarios(self):
        a = self._base()
        a["sentimento_comentarios"] = "misto"
        result = radar.validate_analysis(a)
        self.assertEqual(result["sentimento_comentarios"], "misto")

    def test_all_14_categorias_are_valid(self):
        categorias = [
            "saude", "educacao", "infraestrutura_urbana", "limpeza_urbana",
            "seguranca_publica", "transporte_publico", "saneamento_agua",
            "assistencia_social", "tributos_servicos", "cultura_esporte_lazer",
            "servidores_municipais", "imagem_gestao", "meio_ambiente", "zona_rural",
        ]
        for cat in categorias:
            a = self._base()
            a["categoria_tematica"] = cat
            result = radar.validate_analysis(a)
            self.assertEqual(result["categoria_tematica"], cat, f"Categoria falhou: {cat}")

    def test_all_13_atribuicoes_are_valid(self):
        atribuicoes = [
            "prefeito_pessoal", "prefeitura_instituicao", "secretaria_saude",
            "secretaria_educacao", "secretaria_obras", "secretaria_outra",
            "vereadores", "governo_estadual", "governo_federal",
            "gestao_anterior", "propria_populacao", "empresas_concessionarias", "indefinido",
        ]
        for atrib in atribuicoes:
            a = self._base()
            a["atribuicao"] = atrib
            result = radar.validate_analysis(a)
            self.assertEqual(result["atribuicao"], atrib, f"Atribuicao falhou: {atrib}")


# ─────────────────────────────────────────────────────────────────────────────
# 4. PROFILES_META e ALLOWED_PROFILES
# ─────────────────────────────────────────────────────────────────────────────

class TestProfilesConsistency(unittest.TestCase):
    def test_allowed_profiles_matches_profiles_meta(self):
        self.assertEqual(radar.ALLOWED_PROFILES, set(radar.PROFILES_META.keys()))

    def test_all_profiles_have_categoria_and_influencia(self):
        for username, meta in radar.PROFILES_META.items():
            with self.subTest(username=username):
                self.assertIn("categoria", meta)
                self.assertIn("influencia", meta)
                self.assertIn(meta["influencia"], {"alta", "media", "baixa"})

    def test_prefeito_has_alta_influencia(self):
        self.assertEqual(radar.PROFILES_META["gustavoascarmo"]["influencia"], "alta")
        self.assertEqual(radar.PROFILES_META["prefeituraalagoinhas"]["influencia"], "alta")

    def test_minimum_profile_count(self):
        # Ao menos os 18 perfis originais
        self.assertGreaterEqual(len(radar.PROFILES_META), 18)


# ─────────────────────────────────────────────────────────────────────────────
# 5. update_profile_row — cache behavior
# ─────────────────────────────────────────────────────────────────────────────

class TestUpdateProfileRow(unittest.TestCase):
    def _posts(self, pos=2, neg=1, neu=1):
        data = []
        for _ in range(pos):
            data.append({"sentimento": "positivo"})
        for _ in range(neg):
            data.append({"sentimento": "negativo"})
        for _ in range(neu):
            data.append({"sentimento": "neutro"})
        return data

    def test_updates_existing_row_using_cache(self):
        ws = MagicMock()
        # Cache com header + 1 linha existente para "gustavoascarmo"
        cache = [
            ["perfil", "categoria", "influencia", "total_posts", "positivos",
             "negativos", "neutros", "pct_positivo", "pct_negativo",
             "temperatura", "resumo_geral", "data_atualizacao"],
            ["gustavoascarmo", "Prefeito", "alta", "5", "3", "1", "1",
             "60", "20", "baixa", "resumo antigo", "01/01/2026 00:00"],
        ]
        posts = self._posts(pos=3, neg=1, neu=0)
        new_cache = radar.update_profile_row(
            ws, "gustavoascarmo",
            {"categoria": "Prefeito", "influencia": "alta"},
            posts, "novo resumo", cache
        )
        # Deve ter chamado ws.update (atualização), não ws.append_row
        ws.update.assert_called_once()
        ws.append_row.assert_not_called()
        # Cache deve ter sido atualizado na posição correta
        self.assertEqual(new_cache[1][0], "gustavoascarmo")
        self.assertEqual(new_cache[1][10], "novo resumo")

    def test_appends_new_profile_not_in_cache(self):
        ws = MagicMock()
        cache = [
            ["perfil", "categoria", "influencia", "total_posts", "positivos",
             "negativos", "neutros", "pct_positivo", "pct_negativo",
             "temperatura", "resumo_geral", "data_atualizacao"],
        ]
        posts = self._posts(pos=1, neg=0, neu=1)
        new_cache = radar.update_profile_row(
            ws, "novo_perfil",
            {"categoria": "Politico", "influencia": "media"},
            posts, "primeiro resumo", cache
        )
        ws.append_row.assert_called_once()
        ws.update.assert_not_called()
        # Novo perfil adicionado ao cache
        self.assertEqual(len(new_cache), 2)
        self.assertEqual(new_cache[1][0], "novo_perfil")

    def test_cache_not_called_get_all_values(self):
        """Garante que update_profile_row NÃO chama get_all_values (usa cache)."""
        ws = MagicMock()
        cache = [["perfil"], ["outro_perfil"]]
        radar.update_profile_row(
            ws, "perfil_qualquer",
            {"categoria": "Politico", "influencia": "baixa"},
            self._posts(), "resumo", cache
        )
        ws.get_all_values.assert_not_called()

    def test_temperatura_calculation_in_row(self):
        ws = MagicMock()
        cache = [["perfil"]]
        # 6 negativos em 10 → critica
        posts = [{"sentimento": "negativo"}] * 6 + [{"sentimento": "positivo"}] * 4
        new_cache = radar.update_profile_row(
            ws, "perfil_critico",
            {"categoria": "Politico", "influencia": "alta"},
            posts, "resumo critico", cache
        )
        appended_row = ws.append_row.call_args[0][0]
        self.assertEqual(appended_row[9], "critica")  # temperatura = índice 9


# ─────────────────────────────────────────────────────────────────────────────
# 6. append_post — estrutura da linha
# ─────────────────────────────────────────────────────────────────────────────

class TestAppendPost(unittest.TestCase):
    def _make_item(self):
        return {
            "timestamp": "2026-05-17T13:37:34.000Z",
            "ownerUsername": "gustavoascarmo",
            "likesCount": 150,
            "commentsCount": 5,
            "latestComments": [{"text": "Bom trabalho"}],
        }

    def _make_analysis(self):
        return {
            "sentimento_post": "positivo",
            "sentimento_comentarios": "neutro",
            "tema": "obra de calçamento",
            "urgencia": "baixa",
            "resumo": "Post positivo sobre obras.",
            "atribuicao": "prefeitura_instituicao",
            "categoria_tematica": "infraestrutura_urbana",
            "intensidade": "leve",
            "localizacao": "Centro",
        }

    def test_row_has_14_columns(self):
        ws = MagicMock()
        radar.append_post(ws, "https://instagram.com/p/ABC/", self._make_analysis(), self._make_item())
        row = ws.append_row.call_args[0][0]
        self.assertEqual(len(row), 14)

    def test_url_is_first_column(self):
        ws = MagicMock()
        url = "https://instagram.com/p/TESTURL/"
        radar.append_post(ws, url, self._make_analysis(), self._make_item())
        row = ws.append_row.call_args[0][0]
        self.assertEqual(row[0], url)

    def test_framework_columns_at_end(self):
        ws = MagicMock()
        radar.append_post(ws, "https://x.com/", self._make_analysis(), self._make_item())
        row = ws.append_row.call_args[0][0]
        self.assertEqual(row[11], "infraestrutura_urbana")   # categoria_tematica
        self.assertEqual(row[12], "leve")                    # intensidade
        self.assertEqual(row[13], "Centro")                  # localizacao

    def test_comments_count_uses_commentscount(self):
        ws = MagicMock()
        item = self._make_item()
        item["commentsCount"] = 42
        radar.append_post(ws, "https://x.com/", self._make_analysis(), item)
        row = ws.append_row.call_args[0][0]
        self.assertEqual(row[10], 42)


# ─────────────────────────────────────────────────────────────────────────────
# 7. fetch_apify_items — usa Bearer header
# ─────────────────────────────────────────────────────────────────────────────

class TestFetchApifyItems(unittest.TestCase):
    @patch("radar.requests.get")
    def test_uses_bearer_header(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = []
        mock_get.return_value = mock_response

        radar.fetch_apify_items()

        call_kwargs = mock_get.call_args
        headers = call_kwargs[1].get("headers") or call_kwargs[0][1] if len(call_kwargs[0]) > 1 else {}
        if not headers:
            # positional args might not have headers; check kwargs
            headers = call_kwargs.kwargs.get("headers", {})
        self.assertIn("Authorization", headers)
        self.assertTrue(headers["Authorization"].startswith("Bearer "))

    @patch("radar.requests.get")
    def test_token_not_in_url(self, mock_get):
        mock_response = MagicMock()
        mock_response.json.return_value = []
        mock_get.return_value = mock_response

        radar.fetch_apify_items()

        url_called = mock_get.call_args[0][0]
        self.assertNotIn("token=", url_called)


# ─────────────────────────────────────────────────────────────────────────────
# 8. Análise por perfil — lógica de calc_temperatura e stats
# ─────────────────────────────────────────────────────────────────────────────

class TestAnalyseProfileStats(unittest.TestCase):
    """Testa a lógica interna de analyse_profile sem chamar o Claude."""

    def _make_posts(self, sentimentos):
        return [
            {"sentimento": s, "tema": f"tema_{i}", "resumo": "resumo.", "categoria_tematica": "saude"}
            for i, s in enumerate(sentimentos)
        ]

    def test_calc_temperatura_integration(self):
        # 4 neg / 10 total = 40% → alta
        posts = self._make_posts(["negativo"] * 4 + ["positivo"] * 4 + ["neutro"] * 2)
        negativos = sum(1 for p in posts if p["sentimento"] == "negativo")
        total = len(posts)
        self.assertEqual(radar.calc_temperatura(negativos, total), "alta")


# ─────────────────────────────────────────────────────────────────────────────
# 9. run_pipeline — profiles_meta dinâmico
# ─────────────────────────────────────────────────────────────────────────────

class TestRunPipelineProfilesConsistency(unittest.TestCase):
    def test_run_pipeline_uses_profiles_meta(self):
        """directUrls em run_pipeline deve conter todos os perfis de PROFILES_META."""
        import run_pipeline
        expected_usernames = set(radar.PROFILES_META.keys())
        urls_in_input = run_pipeline.ACTOR_INPUT["directUrls"]
        found_usernames = set()
        for url in urls_in_input:
            # extrai username da URL: https://www.instagram.com/{username}/
            parts = url.rstrip("/").split("/")
            if parts:
                found_usernames.add(parts[-1])
        self.assertEqual(found_usernames, expected_usernames)

    def test_no_hardcoded_list_divergence(self):
        """Número de URLs em ACTOR_INPUT deve ser igual ao número de perfis em PROFILES_META."""
        import run_pipeline
        self.assertEqual(
            len(run_pipeline.ACTOR_INPUT["directUrls"]),
            len(radar.PROFILES_META),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
