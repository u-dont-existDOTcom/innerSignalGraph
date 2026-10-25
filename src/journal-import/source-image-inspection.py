"""Static, source-bound visual inspection gate. Never execute model-authored code."""
import ast
import json
import math
import re
import sys

MAX_INPUT_BYTES = 65536
MAX_CALLS = 24
MAX_CODE_CHARS = 400
FILE_NAME = re.compile(r"journal-image-[0-9]{2}-([0-9a-f]{16})\.(?:png|jpg|webp)\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class Rejected(Exception):
    pass


def require(condition):
    if not condition:
        raise Rejected()


def parse_input(payload):
    require(isinstance(payload, dict))
    files = payload.get("attached_files")
    codes = payload.get("codes")
    statuses = payload.get("statuses")
    require(isinstance(files, dict) and 1 <= len(files) <= 16)
    require(isinstance(codes, list) and 1 <= len(codes) <= MAX_CALLS)
    require(isinstance(statuses, list) and len(statuses) == len(codes))
    require(all(isinstance(code, str) and 1 <= len(code) <= MAX_CODE_CHARS for code in codes))
    require(all(status in ("Analyzed", "AnalysisErrored") for status in statuses))
    require("Analyzed" in statuses)
    for index, status in enumerate(statuses):
        if status == "AnalysisErrored":
            require("Analyzed" in statuses[index + 1:])
    for filename, sha in files.items():
        require(isinstance(filename, str) and isinstance(sha, str) and HEX64.fullmatch(sha))
        match = FILE_NAME.fullmatch(filename)
        require(match is not None and sha.startswith(match.group(1)))
    return files, codes, statuses


def evaluate_code(code, env, attached, observed, operations, successful):
    tree = ast.parse(code, mode="exec")
    require(len(tree.body) <= 12 and sum(1 for _ in ast.walk(tree)) <= 180)
    require(all(not isinstance(n, (ast.FormattedValue, ast.JoinedStr, ast.NamedExpr))
                for n in ast.walk(tree)))

    def number(v):
        require(v[0] == "number")
        return v

    def nums(v, count):
        require(v[0] == "tuple" and len(v[1]) == count)
        for item in v[1]:
            number(item)

    def eval_node(node):
        if isinstance(node, ast.Constant):
            if type(node.value) in (int, float):
                require(math.isfinite(node.value) and abs(node.value) <= 10**7)
                return ("number", node.value)
            if type(node.value) is str:
                require(len(node.value) <= 256)
                return ("literal", node.value)
            raise Rejected()
        if isinstance(node, ast.Name):
            require(node.id in env)
            return env[node.id]
        if isinstance(node, (ast.Tuple, ast.List)):
            require(len(node.elts) in (2, 3, 4))
            return ("tuple", tuple(eval_node(x) for x in node.elts))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            number(eval_node(node.operand))
            return ("number", None)
        if isinstance(node, ast.BinOp) and isinstance(node.op,
                (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod)):
            number(eval_node(node.left))
            number(eval_node(node.right))
            return ("number", None)
        if isinstance(node, ast.Subscript):
            value = eval_node(node.value)
            require(value[0] == "tuple" and isinstance(node.slice, ast.Constant)
                    and type(node.slice.value) is int)
            index = node.slice.value
            require(0 <= index < len(value[1]))
            return value[1][index]
        if isinstance(node, ast.Attribute):
            base = eval_node(node.value)
            if base[0] == "image" and node.attr in ("width", "height"):
                return ("number", None)
            if base[0] == "image" and node.attr == "size":
                return ("tuple", (("number", None), ("number", None)))
            if base == ("module", "Image") and node.attr == "Resampling":
                return ("enum", "Resampling")
            if base == ("enum", "Resampling") and node.attr in ("LANCZOS", "BICUBIC", "NEAREST"):
                return ("resampling", node.attr)
            raise Rejected()
        if not isinstance(node, ast.Call):
            raise Rejected()
        require(not node.keywords)
        if isinstance(node.func, ast.Name):
            name = node.func.id
            if name == "display":
                require(len(node.args) == 1)
                result = eval_node(node.args[0])
                require(result[0] == "image")
                operations.append("display_source_image")
                if successful:
                    observed.update(result[1])
                return ("none", None)
            if name == "print":
                require(1 <= len(node.args) <= 4)
                for arg in node.args:
                    candidate = eval_node(arg)
                    if candidate[0] == "tuple":
                        for item in candidate[1]:
                            number(item)
                    else:
                        number(candidate)
                operations.append("numeric_coordinates")
                return ("none", None)
            if name == "round":
                require(1 <= len(node.args) <= 2)
                number(eval_node(node.args[0]))
                if len(node.args) == 2:
                    require(isinstance(node.args[1], ast.Constant)
                            and type(node.args[1].value) is int and 0 <= node.args[1].value <= 6)
                return ("number", None)
            if name in ("int", "float", "abs"):
                require(len(node.args) == 1)
                number(eval_node(node.args[0]))
                return ("number", None)
            if name in ("min", "max"):
                require(1 <= len(node.args) <= 4)
                for arg in node.args:
                    number(eval_node(arg))
                return ("number", None)
            raise Rejected()
        require(isinstance(node.func, ast.Attribute))
        method = node.func.attr
        base = eval_node(node.func.value)
        if base == ("module", "Image") and method == "open":
            require(len(node.args) == 1 and isinstance(node.args[0], ast.Constant)
                    and type(node.args[0].value) is str)
            absolute = node.args[0].value
            require(absolute.startswith("/mnt/data/") and absolute.count("/") == 3)
            filename = absolute[len("/mnt/data/"):]
            require(filename in attached)
            operations.append("open_attached_image")
            return ("image", frozenset((attached[filename],)))
        if base[0] == "image" and method in ("crop", "resize", "convert"):
            if method == "crop":
                require(len(node.args) == 1)
                nums(eval_node(node.args[0]), 4)
            elif method == "resize":
                require(1 <= len(node.args) <= 2)
                nums(eval_node(node.args[0]), 2)
                if len(node.args) == 2:
                    require(eval_node(node.args[1])[0] == "resampling")
            else:
                require(len(node.args) == 1 and isinstance(node.args[0], ast.Constant)
                        and node.args[0].value in ("RGB", "RGBA", "L"))
            operations.append(method)
            return base
        raise Rejected()

    for statement in tree.body:
        if isinstance(statement, ast.ImportFrom):
            require(statement.level == 0 and statement.module == "PIL"
                    and len(statement.names) == 1 and statement.names[0].name == "Image"
                    and statement.names[0].asname is None)
            env["Image"] = ("module", "Image")
        elif isinstance(statement, ast.Assign):
            require(len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name))
            key = statement.targets[0].id
            require(re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,39}", key)
                    and "__" not in key and key not in
                    ("Image", "display", "print", "round", "int", "float", "abs", "min", "max"))
            v = eval_node(statement.value)
            require(v[0] != "none")
            env[key] = v
        elif isinstance(statement, ast.Expr):
            eval_node(statement.value)
        else:
            raise Rejected()


def verify(payload):
    attached, codes, statuses = parse_input(payload)
    env, observed, operations = {}, set(), []
    for code, status in zip(codes, statuses):
        if status == "AnalysisErrored":
            # A failed execution does not establish persistent image state.
            # Syntax still has to be safe, but any partial assignments, opens
            # or provenance cannot be used by a later successful tool result.
            evaluate_code(code, env.copy(), attached, set(), [], False)
        else:
            evaluate_code(code, env, attached, observed, operations, True)
    require(len(observed) > 0 and len(operations) <= 120)
    return {"verified": True, "inspected_attachment_sha256s": sorted(observed),
            "operations": operations}


try:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    require(len(raw) <= MAX_INPUT_BYTES)
    result = verify(json.loads(raw))
except (Rejected, SyntaxError, UnicodeDecodeError, ValueError, TypeError, KeyError,
        RecursionError, MemoryError, OverflowError):
    result = {"verified": False, "inspected_attachment_sha256s": [], "operations": []}
sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
