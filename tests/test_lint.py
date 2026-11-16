"""Structural lint for contracts/vigil.py.

These tests read the source instead of executing it, so a refactor that quietly
moves a nondet call or a transfer out of its allowed place turns red.
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "vigil.py"
PINNED_HEADER = (
    '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }'
)
STORAGE_PRIMITIVES = {"u256", "u32", "i32", "i64", "Address", "str", "bool"}
PUBLIC_METHODS = {
    "get_owner",
    "get_vault_count",
    "get_vault_json",
    "get_vaults_json",
    "get_credit_of",
    "get_totals",
    "create_vault",
    "check_vault",
    "cancel_vault",
    "refund_vault",
    "withdraw",
}


def source() -> str:
    return CONTRACT.read_text(encoding="utf-8")


def tree() -> ast.Module:
    return ast.parse(source())


def attribute_chain(node) -> str:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def annotation_name(node) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return annotation_name(node.value)
    return type(node).__name__


def class_def(name: str) -> ast.ClassDef:
    for node in tree().body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise AssertionError("class not found: " + name)


def public_methods() -> list:
    found = []
    for node in ast.walk(tree()):
        if isinstance(node, ast.FunctionDef):
            chains = [attribute_chain(d) for d in node.decorator_list if isinstance(d, (ast.Attribute, ast.Call))]
            chains = [c for c in chains if c.startswith("gl.public")]
            if chains:
                found.append((node.name, chains))
    return found


def test_first_line_pins_the_runner_hash():
    assert source().splitlines()[0] == PINNED_HEADER


def test_no_floating_latest_runner():
    assert "py-genlayer:latest" not in source()


def test_contract_parses():
    assert isinstance(tree(), ast.Module)


def test_contract_class_inherits_gl_contract():
    bases = [attribute_chain(base) for base in class_def("Vigil").bases]
    assert "gl.Contract" in bases


def test_vault_is_a_storage_dataclass():
    vault = class_def("Vault")
    decorators = [attribute_chain(d) for d in vault.decorator_list]
    assert "allow_storage" in decorators
    assert "dataclass" in decorators


def test_vault_fields_are_flat_storage_primitives():
    for node in class_def("Vault").body:
        if isinstance(node, ast.AnnAssign):
            name = annotation_name(node.annotation)
            assert name in STORAGE_PRIMITIVES, name


def test_contract_storage_uses_allowed_types():
    allowed = STORAGE_PRIMITIVES | {"TreeMap"}
    for node in class_def("Vigil").body:
        if isinstance(node, ast.AnnAssign):
            name = annotation_name(node.annotation)
            assert name in allowed, name


def test_nondet_calls_live_only_in_the_leader_block():
    lines = source().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip().startswith("def leader_fn"))
    end = next(i for i, line in enumerate(lines) if line.strip().startswith("def validator_fn"))
    hits = [i for i, line in enumerate(lines) if "gl.nondet" in line]
    assert hits, "the contract must use gl.nondet"
    assert all(start < i < end for i in hits)


def test_leader_block_has_no_storage_access():
    lines = source().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip().startswith("def leader_fn"))
    end = next(i for i, line in enumerate(lines) if line.strip().startswith("def validator_fn"))
    block = "\n".join(lines[start:end])
    assert "self." not in block


def test_no_single_argument_treemap_get():
    # TreeMap.get needs a default; a one-argument .get breaks on the node.
    assert not re.search(r"self\.[A-Za-z_][A-Za-z0-9_]*\.get\([^,()]*\)", source())


def test_emit_transfer_appears_once_inside_send_gen():
    lines = source().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip().startswith("def _send_gen"))
    end = next(
        i
        for i, line in enumerate(lines[start + 1 :], start=start + 1)
        if line.startswith("def ") or line.startswith("@")
    )
    block = "\n".join(lines[start:end])
    assert block.count("emit_transfer") == 1
    assert source().count("emit_transfer") == 1


def test_no_emit_inside_check_vault():
    lines = source().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip().startswith("def check_vault"))
    end = next(i for i, line in enumerate(lines) if line.strip().startswith("def cancel_vault"))
    block = "\n".join(lines[start:end])
    assert "emit" not in block


def test_run_nondet_is_used_with_a_validator():
    assert source().count("gl.vm.run_nondet(") == 1
    assert "run_nondet_unsafe" not in source()


def test_no_public_dunder_methods():
    assert not re.search(r"@gl\.public[^\n]*\n\s*def __", source())


def test_no_receive_handler():
    assert "__receive__" not in source()


def test_public_surface_is_small_and_expected():
    names = {name for name, _ in public_methods()}
    assert names == PUBLIC_METHODS


def test_create_vault_is_payable():
    for node in ast.walk(tree()):
        if isinstance(node, ast.FunctionDef) and node.name == "create_vault":
            chains = [attribute_chain(d) for d in node.decorator_list]
            assert "gl.public.write.payable" in chains
            return
    raise AssertionError("create_vault not found")


def test_value_is_read_only_in_create_vault():
    for node in ast.walk(tree()):
        if isinstance(node, ast.FunctionDef):
            has_value = "gl.message.value" in ast.get_source_segment(source(), node)
            if has_value:
                assert node.name == "create_vault"


def test_sender_is_the_creator_boundary():
    text = source()
    assert "creator = gl.message.sender_address" in text
    assert "only the creator can cancel this vault" in text


def test_settlement_requires_agreement_fields():
    text = source()
    assert 'theirs.get("met", None) == mine.get("met", None)' in text
    assert 'theirs.get("injection", None) == mine.get("injection", None)' in text
    assert 'theirs.get("bucket", -1) == mine.get("bucket", -1)' in text
