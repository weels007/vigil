"""Creation guards: lengths, URLs, addresses, deposits and deadlines."""

from conftest import DEADLINE, DEPOSIT, NOW, create_vault, hex_of

LONG_TITLE = "T" * 81
LONG_CONDITION = "c" * 501
LONG_URL = "https://example.com/" + ("a" * 290)


def attempt(contract, vm, creator, beneficiary, **kwargs):
    """Call create_vault directly with a raw beneficiary string."""
    value = kwargs.pop("value", DEPOSIT)
    args = {
        "title": "Aurora ships",
        "condition": "The page announces the release.",
        "url": "https://example.com/aurora",
        "deadline": DEADLINE,
    }
    args.update(kwargs)
    vm.sender = creator
    vm.value = value
    try:
        return contract.create_vault(
            beneficiary,
            args["title"],
            args["condition"],
            args["url"],
            args["deadline"],
        )
    finally:
        vm.value = 0


def test_empty_title_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("title is required"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="")


def test_whitespace_title_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("title is required"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="   ")


def test_overlong_title_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("title is longer"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title=LONG_TITLE)


def test_title_at_the_limit_is_accepted(deploy, direct_vm, actors):
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], title="T" * 80)
    assert int(vault_id) == 0


def test_empty_condition_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("condition is required"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], condition="  ")


def test_overlong_condition_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("condition is longer"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], condition=LONG_CONDITION)


def test_condition_at_the_limit_is_accepted(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], condition="c" * 500)
    assert int(deploy.get_vault_count()) == 1


def test_empty_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url is required"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="")


def test_ftp_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url must start with http"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="ftp://example.com/page")


def test_url_without_scheme_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url must start with http"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="example.com/page")


def test_url_with_whitespace_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url must not contain whitespace"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="https://example.com/a b")


def test_overlong_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url is longer"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url=LONG_URL)


def test_url_without_a_host_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("url must include a host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="https://")


def test_localhost_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://localhost:8080/page")


def test_loopback_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://127.0.0.1/page")


def test_private_ip_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://192.168.1.20/page")


def test_private_172_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://172.20.10.2/page")


def test_link_local_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(
            deploy,
            direct_vm,
            actors["alice"],
            actors["bob"],
            url="http://169.254.169.254/latest/meta-data",
        )


def test_private_suffix_url_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("public host"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://printer.local/status")


def test_public_host_with_digits_is_accepted(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="https://10.example.com/page")
    assert int(deploy.get_vault_count()) == 1


def test_http_url_is_accepted(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url="http://example.com/page")
    assert int(deploy.get_vault_count()) == 1


def test_https_url_with_path_and_query_is_accepted(deploy, direct_vm, actors):
    url = "https://example.com/blog/post?utm=1#top"
    vault_id = create_vault(deploy, direct_vm, actors["alice"], actors["bob"], url=url)
    raw = deploy.get_vault_json(vault_id)
    assert url in raw


def test_beneficiary_equal_to_creator_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("beneficiary must differ"):
        create_vault(deploy, direct_vm, actors["alice"], actors["alice"])


def test_zero_beneficiary_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("zero address"):
        attempt(deploy, direct_vm, actors["alice"], "0x" + "0" * 40)


def test_zero_deposit_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("deposit must be greater than zero"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=0)


def test_deadline_equal_to_now_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("deadline must be in the future"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], deadline=NOW)


def test_deadline_in_the_past_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("deadline must be in the future"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], deadline=NOW - 1)


def test_deadline_one_second_ahead_is_accepted(deploy, direct_vm, actors):
    create_vault(deploy, direct_vm, actors["alice"], actors["bob"], deadline=NOW + 1)
    assert int(deploy.get_vault_count()) == 1


def test_short_hex_address_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("address must be 40 hex characters"):
        attempt(deploy, direct_vm, actors["alice"], "0x1234")


def test_non_hex_address_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("address is not valid"):
        attempt(deploy, direct_vm, actors["alice"], "0x" + ("z" * 40))


def test_empty_address_is_rejected(deploy, direct_vm, actors):
    with direct_vm.expect_revert("address is empty"):
        attempt(deploy, direct_vm, actors["alice"], "   ")


def test_checksummed_address_is_accepted(deploy, direct_vm, actors):
    checksummed = hex_of(actors["bob"])
    vault_id = attempt(deploy, direct_vm, actors["alice"], checksummed)
    assert int(vault_id) == 0


def test_failed_creation_leaves_the_registry_untouched(deploy, direct_vm, actors):
    with direct_vm.expect_revert("deposit must be greater than zero"):
        create_vault(deploy, direct_vm, actors["alice"], actors["bob"], value=0)
    assert int(deploy.get_vault_count()) == 0
    assert deploy.get_vault_json(0) == ""
