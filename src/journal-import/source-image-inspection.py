"""Validate visible Python image-inspection inputs without executing model code."""
import ast
import json
import sys

class Rejected(Exception): pass

def verify(payload):
    files = payload['attached_files']
    codes = payload['codes']
    statuses = payload.get('statuses')
    if statuses is None:statuses=['Analyzed']*len(codes)
    if (not isinstance(files, dict) or not files or not isinstance(codes, list) or not codes
            or not isinstance(statuses,list) or len(statuses)!=len(codes)
            or any(status not in ('Analyzed','AnalysisErrored') for status in statuses)):
        raise Rejected()
    env = {}
    inspected = set()
    operations = []
    functions = {}
    active_functions = set()
    steps = [0]
    terminal_error = [False]
    def require(value):
        if not value: raise Rejected()
    def value(node):
        if isinstance(node, ast.Constant):
            require(type(node.value) in (str, int, float, bool, type(None)))
            return ('literal', node.value)
        if isinstance(node, ast.JoinedStr):
            for part in node.values:
                if isinstance(part, ast.FormattedValue):
                    require(part.conversion in (-1, 115, 114) and part.format_spec is None and data(value(part.value)))
                else:require(isinstance(part, ast.Constant) and isinstance(part.value,str))
            return ('string',None)
        if isinstance(node, (ast.GeneratorExp, ast.ListComp)):
            require(len(node.generators)==1)
            generator=node.generators[0]
            require(not generator.is_async and not generator.ifs)
            iterable=value(generator.iter)
            if iterable[0]=='literal' and isinstance(iterable[1],str):
                require(len(iterable[1])<=4096);iterable=('tuple',[('literal',character) for character in iterable[1]])
            require(iterable[0]=='tuple' and len(iterable[1])<=4096)
            previous=env.copy();items=[]
            for element in iterable[1]:
                steps[0]+=1;require(steps[0]<=20000)
                assign(generator.target,element)
                before=len(operations);item=value(node.elt)
                require(data(item) and all(operation=='pixel_sample' for operation in operations[before:]));items.append(item)
            env.clear();env.update(previous)
            return ('tuple',items)
        if isinstance(node, ast.IfExp):
            require(numeric(value(node.test)))
            a,b=value(node.body),value(node.orelse)
            require(all((numeric(v) and v[0]!='array') or v==('literal',None) for v in (a,b)))
            return ('number',None) if numeric(a) and numeric(b) else ('data',None)
        if isinstance(node, ast.DictComp):
            require(len(node.generators)==1)
            generator=node.generators[0]
            require(not generator.is_async and not generator.ifs)
            iterable=value(generator.iter);require(iterable[0]=='tuple' and len(iterable[1])<=4096)
            previous=env.copy();items=[]
            for element in iterable[1]:
                steps[0]+=1;require(steps[0]<=20000)
                assign(generator.target,element)
                before=len(operations);k,v=value(node.key),value(node.value)
                require(data(k) and data(v) and all(operation=='pixel_sample' for operation in operations[before:]));items.append((k,v))
            env.clear();env.update(previous)
            return ('dict',items)
        if isinstance(node, ast.Name):
            require(node.id in env)
            return env[node.id]
        if isinstance(node, (ast.Tuple, ast.List)):
            return ('tuple', [value(x) for x in node.elts])
        if isinstance(node, ast.Dict):
            require(all(k is not None for k in node.keys))
            return ('dict', [(value(k),value(v)) for k,v in zip(node.keys,node.values)])
        if isinstance(node, ast.Subscript):
            base=value(node.value)
            require(data(base))
            if isinstance(node.slice,ast.Slice):
                for x in (node.slice.lower,node.slice.upper,node.slice.step):
                    if x:require(numeric(value(x)))
                return base
            index=value(node.slice)
            if base[0]=='tuple':
                if index[0]=='literal' and type(index[1])==int:
                    require(-len(base[1])<=index[1]<len(base[1]));return base[1][index[1]]
                require(index[0]=='number' and base[1] and all(numeric(x) and x[0]!='array' for x in base[1]))
                return ('number',None)
            if base[0]=='dict':
                match=[v for k,v in base[1] if k==index];require(len(match)==1);return match[0]
            if base[0]=='pixel':
                require(index[0]=='literal' and type(index[1])==int and 0<=index[1]<4);return ('number',None)
            require(base[0] in ('string','literal','data'));return ('data',None)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = value(node.operand); require(v[0] == 'number' or (v[0] == 'literal' and type(v[1]) in (int, float))); return ('number', None)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod)):
            a, b = value(node.left), value(node.right)
            if not all(numeric(v) for v in (a,b)):
                require(terminal_error[0] and all(data(v) for v in (a,b)));return ('data',None)
            return ('array' if 'array' in (a[0],b[0]) else 'number', None)
        if isinstance(node, ast.Compare):
            require(all(isinstance(x,(ast.Lt,ast.LtE,ast.Gt,ast.GtE,ast.Eq,ast.NotEq)) for x in node.ops))
            vals=[value(node.left)]+[value(x) for x in node.comparators]; require(all(numeric(v) for v in vals)); return ('array' if any(v[0]=='array' for v in vals) else 'number',None)
        if isinstance(node, ast.Attribute):
            base=value(node.value)
            if base[0]=='image' and node.attr=='size':return ('tuple',[('number',None),('number',None)])
            if base[0]=='image' and node.attr in ('width','height'):return ('number',None)
            if base==('module','Image') and node.attr=='Resampling':return ('enum','Resampling')
            if base==('enum','Resampling') and node.attr in ('LANCZOS','NEAREST','BICUBIC'):return ('resample',node.attr)
            if base==('module','PIL') and node.attr=='Image':return ('module','Image')
            raise Rejected()
        if isinstance(node, ast.Call):
            args=[value(x) for x in node.args]
            require(all(x.arg is not None for x in node.keywords))
            kwargs={x.arg:value(x.value) for x in node.keywords}
            if isinstance(node.func,ast.Name):
                name=node.func.id
                require(not kwargs)
                if name=='range':
                    require(1<=len(args)<=3 and all(v[0]=='literal' and type(v[1])==int and abs(v[1])<=4096 for v in args))
                    values=range(*(v[1] for v in args));require(len(values)<=4096)
                    return ('tuple',[('literal',v) for v in values])
                if name=='tuple':
                    require(len(args)==1 and args[0][0]=='tuple' and data(args[0]));return args[0]
                if name=='enumerate':
                    require(1<=len(args)<=2 and args[0][0]=='tuple' and len(args[0][1])<=4096)
                    start=args[1] if len(args)==2 else ('literal',0)
                    require(start[0]=='literal' and type(start[1])==int)
                    return ('tuple',[('tuple',[('literal',i+start[1]),v]) for i,v in enumerate(args[0][1])])
                if name in functions:
                    require(name not in active_functions)
                    fn=functions[name];require(len(args)==len(fn.args.args))
                    previous=env.copy();active_functions.add(name)
                    for arg,v in zip(fn.args.args,args):env[arg.arg]=v
                    result=statements(fn.body)
                    env.clear();env.update(previous);active_functions.remove(name)
                    return result
                if name in ('round','int','float','min','max','abs'):
                    require(args)
                    if not all(numeric(v) and v[0]!='array' for v in args):
                        require(terminal_error[0] and all(data(v) for v in args));return ('data',None)
                    return ('number',None)
                require(name in ('display','print'))
                require(args and all(v[0]=='image' if name=='display' else data(v) for v in args))
                operations.append(name); return ('none',None)
            require(isinstance(node.func,ast.Attribute))
            base=value(node.func.value); method=node.func.attr
            if base==('module','Image') and method=='open':
                require(len(args)==1 and args[0][0]=='literal' and isinstance(args[0][1],str) and not kwargs)
                path=args[0][1]; require(path.startswith('/mnt/data/') and path.count('/')==3)
                name=path.removeprefix('/mnt/data/'); require(name in files and name not in ('.','..'))
                inspected.add(files[name]); operations.append('open_attached_image'); return ('image',None)
            if base==('module','matplotlib.pyplot'):
                if method=='figure':
                    require(not args and set(kwargs)=={'figsize'})
                    size=kwargs['figsize'];require(size[0]=='tuple' and len(size[1])==2 and all(numeric(v) and v[0]!='array' for v in size[1]))
                    operations.append('in_memory_figure');return ('none',None)
                if method=='imshow':
                    require(not kwargs and len(args)==1 and args[0][0]=='image')
                    operations.append('display_source_image');return ('none',None)
                if method in ('xlim','ylim'):
                    require(not kwargs and len(args)==2 and all(numeric(v) and v[0]!='array' for v in args))
                    operations.append('plot_viewport');return ('none',None)
                if method=='grid':
                    require(not args and not kwargs)
                    operations.append('plot_grid');return ('none',None)
                raise Rejected()
            if base==('module','Image') and method=='new':
                require(not kwargs and len(args)==3 and args[0] in [('literal','RGB'),('literal','RGBA'),('literal','L')])
                require(args[1][0]=='tuple' and len(args[1][1])==2 and all(numeric(v) and v[0]!='array' for v in args[1][1]))
                color=args[2]; channels=1 if args[0][1]=='L' else len(args[0][1])
                colors=color[1] if color[0]=='tuple' else [color]
                require(len(colors)==channels and all(v[0]=='literal' and type(v[1])==int and 0<=v[1]<=255 for v in colors))
                operations.append('in_memory_background');return ('image',args[0][1])
            if base==('module','ImageChops') and method=='difference':
                require(not kwargs and len(args)==2 and all(v[0]=='image' for v in args))
                operations.append('pixel_difference');return args[0]
            if base[0]=='image' and method=='getbbox':
                require(not args and not kwargs)
                operations.append('pixel_bounds');return ('tuple',[('number',None)]*4)
            if base[0]=='image' and method=='getpixel':
                require(not kwargs and len(args)==1 and args[0][0]=='tuple' and len(args[0][1])==2
                    and all(numeric(v) and v[0]!='array' for v in args[0][1]))
                operations.append('pixel_sample')
                if base[1]=='L':return ('number',None)
                if base[1] in ('RGB','RGBA'):return ('tuple',[('number',None)]*(3 if base[1]=='RGB' else 4))
                return ('pixel',None)
            if base[0]=='image' and method in ('convert','crop','resize','rotate','copy'):
                if method!='rotate':require(not kwargs)
                if method=='convert':require(len(args)==1 and args[0] in [('literal','RGB'),('literal','RGBA'),('literal','L')])
                elif method in ('crop','resize'):require((len(args)==1 or (method=='resize' and len(args)==2 and args[1][0]=='resample')) and args[0][0]=='tuple' and len(args[0][1])==(4 if method=='crop' else 2) and all(numeric(x) and x[0]!='array' for x in args[0][1]))
                elif method=='rotate':
                    require(len(args)==1 and numeric(args[0]) and args[0][0]!='array')
                    require(set(kwargs)<= {'expand'} and all(v[0]=='literal' and type(v[1])==bool for v in kwargs.values()))
                else:require(not args)
                operations.append(method)
                return ('image',args[0][1]) if method=='convert' else base
            if base==('module','numpy'):
                require(not kwargs and len(args)==1)
                if method in ('array','asarray'):require(args[0][0]=='image');return ('array',None)
                if method=='where':require(args[0][0]=='array');return ('tuple',[('array',None),('array',None)])
                if method in ('int64','int32'):require(numeric(args[0]) and args[0][0]!='array');return ('number',None)
            if base==('module','json') and method=='dumps':
                require(len(args)==1 and data(args[0]) and set(kwargs)<= {'ensure_ascii','indent','sort_keys'})
                require(all(v[0]=='literal' and type(v[1]) in (bool,int,type(None)) for v in kwargs.values()))
                operations.append('serialize_source_result');return ('string',None)
            if base[0]=='dict' and method=='items':
                require(not args and not kwargs);return ('tuple',[('tuple',[k,v]) for k,v in base[1]])
            if base[0]=='array' and method in ('any','all','min','max'):
                require(not args and set(kwargs)<= {'axis'})
                require(all(numeric(v) and v[0]!='array' for v in kwargs.values()))
                return ('array' if 'axis' in kwargs else 'number',None)
            if method=='replace' and (base[0]=='string' or (base[0]=='literal' and isinstance(base[1],str))):
                require(len(args)==2 and not kwargs and all(v[0]=='literal' and isinstance(v[1],str) for v in args))
                if base[0]=='literal':return ('literal',base[1].replace(args[0][1],args[1][1]))
                return ('string',None)
            if method=='count' and (base[0]=='string' or (base[0]=='literal' and isinstance(base[1],str))):
                require(len(args)==1 and not kwargs and args[0][0]=='literal' and isinstance(args[0][1],str))
                if base[0]=='literal':return ('literal',base[1].count(args[0][1]))
                return ('number',None)
            raise Rejected()
        raise Rejected()
    def data(v):
        if v[0] in ('literal','number','string','data','pixel','none'):return True
        if v[0]=='tuple':return all(data(x) for x in v[1])
        if v[0]=='dict':return all(data(k) and data(x) for k,x in v[1])
        return False
    def numeric(v):return v[0] in ('number','array','pixel') or (v[0]=='literal' and type(v[1]) in (int,float,bool))
    def assign(target,v):
        if isinstance(target,ast.Subscript):
            require(isinstance(target.value,ast.Name) and target.value.id in env and data(v))
            base=env[target.value.id];require(base[0]=='dict' and len(base[1])<4096)
            key=value(target.slice);require(key[0] in ('literal','number','string'))
            base[1].append((key,v));return
        if isinstance(target,ast.Name):
            require(not target.id.startswith('_') and target.id not in ('range','tuple','enumerate','display','print','Image','ImageChops','PIL','np','numpy','json','round','int','float','min','max','abs'))
            env[target.id]=v;return
        require(isinstance(target,(ast.Tuple,ast.List)) and v[0]=='tuple' and len(target.elts)==len(v[1]))
        for name,val in zip(target.elts,v[1]):assign(name,val)
    def statements(nodes):
        for node in nodes:
            steps[0]+=1;require(steps[0]<=20000)
            if isinstance(node,ast.ImportFrom):
                require(node.module=='PIL' and node.level==0 and 1<=len(node.names)<=2 and all(a.name in ('Image','ImageChops') and a.asname is None for a in node.names))
                for alias in node.names:env[alias.name]=('module',alias.name)
            elif isinstance(node,ast.Import):
                for alias in node.names:
                    require((alias.name,alias.asname) in [('numpy','np'),('numpy',None),('PIL',None),('json',None),('matplotlib.pyplot','plt')])
                    env[alias.asname or alias.name]=('module',alias.name)
            elif isinstance(node,ast.Assign):
                require(len(node.targets)==1);assign(node.targets[0],value(node.value))
            elif isinstance(node,ast.Expr):value(node.value)
            elif isinstance(node,ast.Return):return value(node.value)
            elif isinstance(node,ast.FunctionDef):
                require(not active_functions and not node.decorator_list and not node.returns
                    and not node.args.defaults and not node.args.kw_defaults and not node.args.kwonlyargs
                    and not node.args.vararg and not node.args.kwarg and not node.args.posonlyargs
                    and node.name not in env and node.name not in ('enumerate','display','print','round','int','float','min','max','abs'))
                require(all(not a.annotation and not a.arg.startswith('_') for a in node.args.args))
                functions[node.name]=node
            elif isinstance(node,ast.For):
                require(not node.orelse)
                iterable=value(node.iter);require(iterable[0]=='tuple' and len(iterable[1])<=4096)
                for element in iterable[1]:assign(node.target,element);statements(node.body)
            else:raise Rejected()
        return ('none',None)
    for code,status in zip(codes,statuses):
        require(isinstance(code,str) and 0<len(code)<=65536)
        terminal_error[0]=status=='AnalysisErrored'
        tree=ast.parse(code);require(sum(1 for _ in ast.walk(tree))<=12000)
        statements(tree.body)
    require(bool(inspected))
    return {'verified':True,'inspected_attachment_sha256s':sorted(inspected),'operations':operations}

try:
    payload=json.loads(sys.stdin.read(1048577))
    result=verify(payload)
except (Rejected,SyntaxError,KeyError,TypeError,ValueError,RecursionError,MemoryError):
    result={'verified':False,'inspected_attachment_sha256s':[],'operations':[]}
print(json.dumps(result))
