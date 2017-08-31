/*
    Copyright Tweega Limited 2015
	
	This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
	
	
	/*
	This program tries to do for JavaScript data structures what XPath does for XML - provide navigation features
	
	compileJutzPath function
	
	paths are 'compiled' by the function compileJutzPath into a chain of functions that are wrapped in an object (returned by compileJutzPath) that provides the following methods
		
	.findOne = function(data) 
	.findAll = function(data) 
	.forEach = function(mode, data, f) 
	
	Paths are similar in structure to XPath although the @ symbol appears at the end of the token
	Examples:	
	"X/Y/*[attr@ = 'value']"
	"X/Y/*[attr@ = 'value'][another_attr@ = 'another_value']"
	"X[attr@ = 'value']/Y/*[another_attr@ = 'another_value']"
	"X//Y"
	
	a note on arrays - if Y is an array [] then to access, or to test the elements of the array with a predicate, you need to add '/*' to the path as can be seen in the example above
	if Y is an object {} then all own properties are regarded as children - in the 3rd example X and Y are assumed to be objects.  Arrays can have properties but do not normally.
	
	axes currently supported are 
		/ for child
		// for descendants
		
		The data and infrastructure exists to support the parent axis
		and ancestor axis after a fashion.  The restriction is that the //operator currently flattens all descendants into sibings
		so you would not be able to combine that with a test of parent node name
		However, that a work around for that is being considered which involves a lazy evaluation of descendants - at the moment they are fetched in one go.
		
	predicates are wrapped in [] as in example above
	
	predicate operators
		only = and != are implemented at the moment, though implementing other operators is trivial.
	
	using the data
	
	where mode is an enumeration indicating whether to process the first data node, or all
	data is an object {...}
	and f is a function which takes 1 argument - the current data item 

	enumMode.SINGLE = new enumMode(0, "single");
	enumMode.MULTI = new enumMode(1, "multi");	
	
	findAll actually uses forEach
		var c = this.forEach(enumMode.MULTI, data, function(d) {
			results.push(d);
		});
		
	Still to come are notes on how paths are  compiled and executed.  The gist is that there are 2 sets of stacks, one for functions and the other for arguments
	There will be a current stack for both funcs and args
	functions are put on the current function stack.  The function objects have an argCount field set.  Every time somehting is added to current arg stack, the 
	top function in current func stack is checked for its arg count.  If there are that many args in the current arg stack, those args are closured into the func
	and wrapped in an interator object which has a next function.
	when args are wrapped into a func, normally that arg stack is closed and the previous stack in the stack array is set to current.
	Where functions hvae no arguments or argumants are otherwise known, they may be put straight onto the arg stack.  This might also be done to prevent funcs in func stack
	from grabbing args from the arg stack before its really their turn.
	
	what we end up with is a set of chained iterators that are lazily evaluated.  For X/Y/Z we would have three linked iterators all wrapped in an API object (resolver) which
	exposes methods such as findOne
	
	The resolver api object asks the tail (Z) for its values.  Z won't have one for its current context (it does not have a context yet), so it asks its parent  Y for a context.
	Y does not have one and asks X.  X is given the initial data as its context  as in findOne(myData) - myData would be passed to the X iterator.  X can now give to Y -> gives to Z.
	Whenever Z runs out of data it asks Y for next context.  When Y runs out it asks X, but in this case X only has the one conext (myData) and so replies null
	and nul passed through Y to Z and so search stops.
	
	In terms of parsing paths - there is a general concept of function and token (argument) 
	in /X 
	/ is function (child put on func stack
	X is token and value X put on arg stack.  In this case child function only requres one arg so value 'X 'would be closured into child function and that wrapped into iterator and placed on arg stack.
	
	More, hopefully clearer, notes in due course.
	
		
	*/
	Array.prototype.clear = function() {
		while (this.length > 0) {
			this.pop();
		}
	}


	function enumMode(value, name) {
		this.value = value;
		this.name = name;
	}

	enumMode.prototype.getValue = function () {
		return this.value;
	};

	enumMode.prototype.toString = function () {
		return this.name;
	};

	enumMode.SINGLE = new enumMode(0, "single");
	enumMode.MULTI = new enumMode(1, "multi");	


	function enumFuncType(value, name) {
		this.value = value;
		this.name = name;
	}

	enumFuncType.prototype.getValue = function () {
		return this.value;
	};

	enumFuncType.prototype.toString = function () {
		return this.name;
	};

	enumFuncType.ITERATOR = new enumFuncType(0, "iterator");
	enumFuncType.FILTER = new enumFuncType(1, "filter");	
	enumFuncType.SELECTOR = new enumFuncType(2, "selector");
	enumFuncType.PREDICATE = new enumFuncType(4, "predicate");		
	
	function compileJutzPath(path) {

		var argStacks = [[]];
		var functionStacks = [[]];
		
		var pathBits = path.split(";");
		path = pathBits[0];
		var fieldName = pathBits[1];
		if (typeof(fieldName) == "undefined") {fieldName = "?"}
				
		path = path.replace("//", "#/");	//could alternatively handle '/' and peek ahead, replacing with # and incrementing endIndex
		path = path.replace("::", ":");	//similarly here.

		var pathLen = path.length;
		
		function createResolver() {			
			var startIndex = 0;
			var endIndex = 0;
			var func = null;
			var arg = null;
			var c = "";
			var token = "";
			var tokenArray = [];
			var filterStack = [];	//array on stack indexes indicating  where predicate openers are
			var startTokens = "[(/";
			var stopTokens = ")]/";
			//var quoteTokens = "\"'"
			var comparatorDictionary = {"<" : {}, ">" : {}, "<=" : {}, ">=" : {}, "!=" : {}, "=" : {}};
			var terminators = startTokens + stopTokens + "/:'@ .";
			var breakTokens = terminators + "/:' ";
			var tokenIsArg = false;			
			var quoteCountMod2 = 0;	//should toggle between 0 and 1
			var bIncrementStack = false;			
			var stackIndex = 0;
			var pathIterator = stringIterator(path);		
			var head = null;
			var tailIterator = null;
			
			c = pathIterator.next();
			while (c != null) {
				tokenIsArg = false;
				while (c != null && terminators.indexOf(c) == -1) {
					//build up token in this loop
					//console.log("reading char: " + c + " with index : " + endIndex);
					tokenArray.push(c);
					c = pathIterator.next();
				}
				
				token = tokenArray.join('');
				//console.log("reading token: " + token  + " with stopper: " + c);
				
				tokenArray.clear();				
				func = null;
				
				//the token has either function name or argument name or both.
				if (token.length >  0) {	//this will not allow empty string '' - which it probably should tk
				
					switch (token) {
						
						case "*" :							
							//* requires a selector other than default					
														
							//we need to increment the stack (do we actually need to increment function stack as often as we do - can this be out of phase with arg stack?
							//we want to put iterator(children) onto argument stack
							/*
							stackIndex++;	
							argStacks[stackIndex] = [];
							functionStacks[stackIndex] = [];
							*/
							
							//put child selector function onto stack
					
							argStacks[stackIndex].push(iterator(children));	//not looking to bind arguments to function at this point, so not calling addArgument
							
						break;
						
						case "#" :	//equivalent to // in the original xpath expression
									//* requires a selector other than default					
														
							//put descendantNoChildren selector function onto stack
					
							argStacks[stackIndex].push(iterator(descendantsNotArrays));	//not looking to bind arguments to function at this point, so not calling addArgument
							
						break;
						
						default :	
							if (comparatorDictionary[token] != null) {
								func = createComparatorFunc(token);
								
								var l = filterStack.length;
								var x = filterStack[l - 1];
								x.predicate = func;
								func = null;
								bIncrementStack = true;
							}
							else {
								if (c == "'") {
									//assuming that this must be the second quote mark, otherwise we would not have a token - we did have a toggle counter but token is empty for the first occurence. - may want to add that check in for syntax sake.
									func = literal;
									//func.name = "jjj";
									tokenIsArg = true;							
									
								}
								else {								
									if (c == "@") {							
										func = createCreator(attribute);  // attribute method needs to bind with token argument - the match pattern
										tokenIsArg = true;							
									}									
									else {							
										func = createCreator(child);  // child method needs to bind with token argument - the match pattern
										tokenIsArg = true;							
									}									
								}
							}
						break;
					}
				}
				
				if (func != null) {			
					functionStacks[stackIndex].push(func);
				}
				//else {console.log("null func");}
				
				//if this is also an argument, then add to argument stack
				if (tokenIsArg) {												
					
					addArgument(token, stackIndex);					
					
				}
				
				if (bIncrementStack == true) {
					stackIndex++;	
					argStacks[stackIndex] = [];
					functionStacks[stackIndex] = [];
					bIncrementStack = false;
				}			
				
				//act on terminator
				switch (c) {
				
					case "[" :
						//start new filter stack
						
						
						stackIndex++;
						
						filterStack.push({index : stackIndex, predicate : null});	//so that on "]" we can find the opener									
						argStacks[stackIndex] = [];
						functionStacks[stackIndex] = [];
						
						//create inputs on their own stacks so that they can be rolled up as single entities
						stackIndex++;
						
						argStacks[stackIndex] = [];
						functionStacks[stackIndex] = [];
												
					break;
										
					case "]" :
						
						
						var filterStackInfo = filterStack.pop();
						
						//close down each stack  - if filterstack is 1 and stack is still 1 then 1 - 1 + 1 = 1 stacks to clear						
						//not sure if there will ever be more than a single stack to clear in which case we can do without the filterCount loop.
						var filterCount = stackIndex - filterStackInfo.index + 1;
						
						
						var tail = null;
						while (stackIndex > filterStackInfo.index) {						
							//what we have now is a filter stack, and then a stack per input
							//so we go down through the stacks, roll them up, then add as arguments to the filter stack
							
							var iterCount = argStacks[stackIndex].length;												
							tail = argStacks[stackIndex][iterCount - 1];
							
							//assume that we always have one form of iterator or another - could perhaps do a check for this.
							
							
							var headFunc = rollupArguments(stackIndex);	//this will clear the stack
						
							
							//ultimately we want the context iterator of headfunc to be the filter object
							//not sure that we really need the passthrough iterator.
							//headFunc.setContextIterator(head); //context will be set by the filter object
							
							var headTail = {"head" : headFunc, "tail" : tail};
							argStacks[filterStackInfo.index].push(headTail);	//all of the input iterators go onto the stack reserved for this filter

							argStacks[stackIndex] = null;
							argStacks.pop();
							functionStacks[stackIndex] = null;	
							functionStacks.pop();	

							stackIndex--;
							
						}
						
						//stackIndex and filterStackIndex should now be the same
						if (stackIndex != filterStackInfo.index){console.log("stackIndex and filterStackIndex not the same");}
						
						//now all the inputs are in the arg stack for filter index
						func = filter;						
						func = createCreator(func);
						
						
						functionStacks[stackIndex].push(func);
						
						//add predicate function and trigger pulling together of the filter parts.

						addArgument(filterStackInfo.predicate, stackIndex);
						filterStackInfo = null;
						
						//now move the filter expression down one
						var y = argStacks[stackIndex].pop();
						
						argStacks[stackIndex] = null;
						argStacks.pop();
						functionStacks[stackIndex] = null;	
						functionStacks.pop();	

						stackIndex--;
						
						
						argStacks[stackIndex].push(y);
							
					break;
					
					case "/" :
					case "@" :
						//we used to set up an iterator here - but this is doone by selector which wraps itself in iterator.
					break;
					case '.' :
						//we need to create an iterator that returns its parent 
						argStacks[stackIndex].push(iterator(selbst)); //is this the right stack to push it on?
					break;
					case "'" :
						quoteCountMod2 = (quoteCountMod2 + 1) % 2;
						if (token.length > 0 && quoteCountMod2 != 0) {
							console.log("no matching quote mark");
						}					
					break;
					default :
						//alert("should not get here - c default : " + c);
					break;
				}
				
				c = pathIterator.next();						
			}
			
			do {
				//if the fStack is not clear at this stage, we probably have a syntax error - all functions should be resolved into arguments by now.
				if (functionStacks[stackIndex].length > 0) {
					console.log("should this not be empty?");
					for (var i = 0; i < functionStacks[stackIndex].length; i++) {
						console.log(functionStacks[stackIndex][i].name);
					}
				}
				
				//i don't think we need the next bit
				
				//copy down functions from current stack to previous stack - i think we should sequence them first and only copy one argument down.								
				
				if (stackIndex > 0) {
				
					var rollupFunc = rollupArguments(stackIndex);	//this will empty the argStack	
					var ii = stackIndex > 0 ? stackIndex - 1 : 0;				
					console.log("do we get here#?");	//don't think so.  Haven't for a long while.
					//no sign of push functionin rollupargs. - so this is probably getting thrown away tk.
					//path = "A/X/*/Y[j@ = 'bonjour'"; = NO we were only getting here due to error in path - no final ]
					console.log(stackIndex);
				}
				else {
					//create an object that has an execute method taking an iterator which has access to head and tail of chain
					var iterCount = argStacks[0].length;
					head = passthroughIterator();	//is passthrough iterator really needed? tk
					tailIterator = argStacks[0][iterCount - 1];
					var headFunc = rollupArguments(stackIndex);	//this will clear the root stack
					headFunc.setContextIterator(head); //sets the root context to be whatever the user passes in as context.
					//set stack objects to null?
				}
				//do we need to pop / clear up anything here tk
				stackIndex--;
				
			} while (stackIndex > -1);
			
			return xPathResolver(head, tailIterator, path);
		}
		
		var xPathResolver = function(head, tailIterator, path) {
			//should this be inside createResolver function?
			
			var resolver = function() {
				//resolver function constructor
			}
			
			resolver.version = "JSO";
			
			resolver.getPath = function() {
				return path;
			},
			
			resolver.getFieldName = function() {
				return fieldName;
			},
			
			resolver.findOne = function(data) {
				var iter = selectSelfAsNodeList(data);
				head.setIterator(iter);
				tailIterator.mode = enumMode.SINGLE;
				
				//use the forEach method on the iterator
				var retVal = tailIterator.next();
				tailIterator.reset();
				return retVal; //this presumably will require a reset all the way up the chain. in which case we will need context / parent info
			}
			
			resolver.findAll = function(data) {
				var results = [];

				var c = this.forEach(enumMode.MULTI, data, function(d) {
					results.push(d);
				});
								
				return results;
			}
			
			resolver.forEach = function(mode, data, f) {
				var iter = selectSelfAsNodeList(data);
				head.setIterator(iter);
				tailIterator.mode = mode;	//it is only the tail (the lowest level of granularity) tht cares about mode
				var resultCount = 0;
				//use the forEach method on the iterator
				var x = tailIterator.next();	//iterator itself might have for each functionality
				while (x != null) {					
					f(x);	//perhaps f(x) could have a return value which we could count or sum
					x = tailIterator.next();
					resultCount++;
				}
				tailIterator.reset();
				return resultCount;
			}
			
			return resolver;
		}
		
		
		var passthroughIterator = function() {
			var iterator = null;
			
			//may be able to rationalise with iterator - but nodelist iterator is simple flat structure, not nested.

			var iIterate = function() {		
				//simpleIterator	: iIterate		
				
			};
			
			iIterate.setIterator = function(iter) {
				this.iterator = iter;
			}
			
			iIterate.next = function() {
				return this.iterator.next();
			}
			
			iIterate.reset = function() {
				this.iterator.reset();
			}
			
			iIterate.isIterator = true;
			
			return iIterate;
		}
		
				
		//iterator was here
		
		var createCreator = function(func) {
			//what is returned from here is a function that still requires arguments to be wrapped into it.
			//this function will be run when enough arguments are present for it on the argument stack.
			var creatorFunc = function(args) {				
				return func(args);				
			}
			creatorFunc.argCount = func.argCount;
			creatorFunc.name = func.name;
			return creatorFunc;
		}
		
		var createComparatorFunc = function(comparator) {
			var func = null;
			
			switch (comparator) {
				case "=" :
					func = function (cxArray) {
						//var l = cxArray.length;
						//check that there are at least 2 elements in context array? tk
						var result = true;
						if (cxArray[1] != "?") {	//ideally would have a predicate without comparator function ie [attr@] instead of [attr@ = '?'] but using this fudge for the moment.
							result = cxArray[0] == cxArray[1];	
						}
						return result;
					}					
				break;
				case "!=" :
					func = function (cxArray) {
						//var l = cxArray.length;
						//check that there are at least 2 elements in context array? tk
						var result = true;
						result = cxArray[0] != cxArray[1];	
						
						return result;
					}
				break;
			}

			func.argCount = 0;	//arguments to comparator will be in context array.
			func.name = comparator;
			return func;
		}
		
		var rollupArguments = function(stackIndex) {
			
			//this function assumes that all entries on the argument stack are now functions.  We could check this and provide debug info if not.
			var argStack = argStacks[stackIndex];			
			var func = null;
			var funcParent = null;
			var unrecognisedFuncType = false;
			
			if (argStack.length > 1) {
				func = argStack.pop();
				
				// func : predicate, funcParent : predicate - predicate chain preserve order from head to tail.
				
				while (funcParent = argStack.pop()) {					
					//this is the type of object being added
					
					if (func.funcType == enumFuncType.ITERATOR) {					
						if (funcParent.funcType == enumFuncType.ITERATOR) {
							//chaining 2 iterators // func : iterator, funcParent : iterator - chain from tail to head
											
							func.setContextIterator(funcParent);//we may need to make the chaining function something dynamic which is wrapped into the object via the stack - to reflect and or logic
						}
						else {
							if (funcParent.funcType == enumFuncType.FILTER) {
								// func : iterator, funcParent : predicate - predicate gives data  to iterator chain from head to tail - which means that predicate is an iterator
								//so chain again from tail to head - which means that we will have to add iterator interface to predicates
								
								func.setContextIterator(funcParent);
							}
							else {
								unrecognisedFuncType = true;
							}						
						}
					}
					else {
						if (func.funcType == enumFuncType.FILTER) {					
							if (funcParent.funcType == enumFuncType.ITERATOR) {
								// func : predicate, funcParent : iterator - iterator has filter - set filter head in iterator
								
								//("Linking iterators");
								func.setContextIterator(funcParent);//we may need to make the chaining function something dynamic which is wrapped into the object via the stack - to reflect and or logic
							}
							else {
								if (funcParent.funcType == enumFuncType.FILTER) {
									// func : iterator, funcParent : predicate - predicate gives data  to iterator chain from head to tail - which means that predicate is an iterator
									//so chain again from tail to head - which means that we will have to add iterator interface to predicates
									//("Linking iterators");
									func.setContextIterator(funcParent);
								}
								else {
									unrecognisedFuncType = true;
								}						
							}
						}
					}
					
					func = funcParent;
				}
			}
			else {
				//just copy this one arg over without chaining
				func = argStack.pop();
			}
			
			return func;	//return the head of the chain.
		}
		
		var addArgument = function(arg, stackIndex) {
			argStacks[stackIndex].push(arg);
			
			var fStack = functionStacks[stackIndex];
			var endIndex = fStack.length;
			var func = null;
			var argCount = 0;
			//check if the addition of this argument means that a function has all its arguments now
			
			while (endIndex > 0) {	//process all functions on this stack until they are either all gone or there are insufficient args
				endIndex--;
				func = fStack[endIndex];
				argCount = argStacks[stackIndex].length;
				
				if (func.argCount <= argCount) {
					
					var ff = func(argStacks[stackIndex]);	//ff is closure of func with arguments - curry?
					var fun = fStack.pop();	//take the function off the function stack - it is now in ff TK we have shadow variable here use somehting else
					
					//the argstack should be empty by now if func is doing its job
					//if the function is a comparator, the result gets written to the previous stack
					//this should happen anyway as a comparitor will be inside a predicate which will copy everything down.
					argStacks[stackIndex].push(ff);
					
				}
				else {
					break;
				}
			}			
		}
	
		return createResolver();

	}
	
	
	var literalIterator = function(token, repeat) {
		var tokenCopy = token;
		
		if(typeof(repeat) == "undefined") {
			repeat = false;
		}
		
		var iIterate = function() {
			//iIterate 							
		}			
		
		iIterate.next = function() {
			var retVal = token;
			if (repeat == false) {
				token = null;
			}
			
			
			return retVal;
		}
		
		iIterate.reset = function() {
			//iIterate.reset
			token = tokenCopy;
		}

		iIterate.setContextIterator = function(it) {
			//literal not dependent on data input
		};
	
	
		iIterate.isIterator = true;
		iIterate.funcType = enumFuncType.ITERATOR;
		return iIterate;
		
	}
	
	var literal = function(args) {
		var lit = args.pop().toString();
		//check data type of literal? tk
		
		lit = lit.replace("'", "");	//do we need to do this - does the stopper get added to the token?
		var func = literalIterator(lit, true);
		func.argCount = 1;			
		func.name = "literal";
		return func;
	}
	
	literal.name = "literal";
	literal.argCount = 1;
		
	var attribute = function(args) {
		var attributeName = args.pop();
		
		var f = function(cx) {
		
		var result = null;
			if (Object.prototype.toString.call(cx) == "[object Array]") {
			//console.log("trying to get an attribute from an array: " + attributeName);	//note that is we are doing wildcard search with attribute check //* this might be inevitable
			}
			
			//need to check if cx is an object?
			if (cx.hasOwnProperty(attributeName)) {
				result = cx[attributeName];
		
				if (typeof(result) == "object") {
					//any other way of testing for a primitive data type?
					result = null;
				}
			}
			return literalIterator(result);
		}
		
		f.name = attribute.name;
		return iterator(f);
	}
		
	attribute.argCount = 1; //better to put these in with the functions?
	attribute.name = "attribute";

	var selbst = function(cx) {	//can't use the keyword self - could use 'dot' i suppose.	
		return nodelistIterator([cx]);
	}
	selbst.funcType = enumFuncType.SELECTOR;
	selbst.name = "selbst";
	
	var child = function(args) {
		var childName = args.pop();
		
		var f = function(cx) {
			var result = [];
			
			var infant = function(context) {
				if (context.hasOwnProperty(childName)) {
					var kind = context[childName];
					
					if (typeof(kind) != "object") {
					//console.log ("pushing null");
						result.push(null);
					}
					else {
						result.push(kind);					
					}
				}
			};
			
			if (Object.prototype.toString.call(cx) == "[object Array]") {
				cx.forEach(function(d) {
					infant(d);
				});
			}
			else {
				infant(cx);
			}
			
			return nodelistIterator(result);			
		}
		f.funcType = enumFuncType.SELECTOR;
		f.name = child.name;
		return iterator(f);
	}
		
	child.argCount = 1; //better to put these in with the functions?
	child.name = "child";
	
	
	
	var children = function(cx) {
		var kinder = [];
		
		//if we have an array, then simply return that - or just objects in that?
		if (typeof(cx) == "object") {
			if (Object.prototype.toString.call(cx) == "[object Array]") {			
				cx.forEach(function(d) {
					if (typeof(d) == "object") {
						kinder.push(d);
					}
				});
			}
			else {
				//otherwise assuming that we have an object
				for (var key in cx) {		
					if (cx.hasOwnProperty(key)) {			
						var res = cx[key];
						if (typeof(res) == "object") {
							kinder.push(res);
						}
					}
				}
			}		
		}		
		return nodelistIterator(kinder);
	}
	
	children.funcType = enumFuncType.SELECTOR;
	children.name = "children";
	
	
	var descendantsNotArrays = function(cx) {
		var descendants = [];
		
		walkDocument(cx);
		
		function walkDocument(node) {					
			childIterator = children(node);
			childIterator.forEach(function(d) {				
				if (typeof(d) == "object") {				
					if( Object.prototype.toString.call( d ) != '[object Array]' ) {	//children are listed individually so don't include the array
						descendants.push(d);
					}
					walkDocument (d);					
				}								
			});
		}

		return nodelistIterator(descendants);
	}
		
	var iterator = function(selectorFunc) {
		
		var nullIterator = {
			next : function() {
				return null;
			}
		};
	
		var index = 0;	
		var dataIterator = nullIterator;
		var contextIterator = null;
		var complete = false;
		var iIterate = function() {
			//iterator.iIterateasd
		}

		iIterate.next = function() {
			var retVal = null;
			
			/*
			if we have a current data set then return from that
			*/
			
			if (complete == false) {
				if(dataIterator == null) {
					console.log("hey - dataiterator is null");
				}
				
				retVal = dataIterator.next();
				
				while (retVal == null) {
					//get the next parent context
					dataIterator = this.getIterator();

					if (dataIterator == null) {
						break;	//no more parent contexts
					}
					retVal = dataIterator.next();
					
					if ((retVal != null) && (this.mode == enumMode.SINGLE)) {
					
						complete = true;
					}
				}
			}			
			
			return retVal;
		}
		
		iIterate.parent = function() {
		//iIterate.parent 
		}
		
		iIterate.getIterator = function() {
			var retVal = null;
			
			//get context from parent iterator
			
			var parentContext = contextIterator.next();					
			
			if (parentContext != null)  {
				retVal = selectorFunc(parentContext);
			}
			
			
			return retVal;
		}
		
		iIterate.reset = function() {
			index = 0;
			complete = false;
			dataIterator = nullIterator;					
			contextIterator.reset();	//reset the parent iterator
		}			
		
		iIterate.setContextIterator = function(it) {			
			
			contextIterator = it;
		};
	
		iIterate.forEach = function(f) {			
			var x = this.next();
			while (x != null) {
				f(x);
				x = this.next();
			}
		}
		
		iIterate.isIterator = true;	//needed?
		iIterate.funcType = enumFuncType.ITERATOR;
				
		return iIterate;
	}
	
	iterator.argCount = 1;
	iterator.name = "iterator"
	
	
	var stringIterator = function(str) {
		var index = 0;
		//check if actually string? tk
		var strLen = str.length;
		
		var iIterate = function() {
		//stringIterator var iterate
		
		};
		
		iIterate.next = function () {
			if (index < strLen) {										
				return str[index++];					
			}
			else {
				this.reset();
				return null;
			}
		};
			
		iIterate.reset = function() {
			index = -1;
		};
		
		iIterate.isIterator = true;
		
		return iIterate;
		
	}
	
	var nodelistIterator = function(nodelist) {
		var index = 0;			
		var listLen = nodelist.length;

		//may be able to rationalise with iterator - but nodelist iterator is simple flat structure, not nested.

		var iIterate = function() {		
			//nodelistIterator	: iIterate		
			
		};
		
		iIterate.next = function() {
		
			if (index < listLen) {
			
				return nodelist[index++];
			}
			else {
				//this.reset();
				return null;
			}
		}
		
		iIterate.reset = function() {
		
			index = 0;
		}
		
		iIterate.forEach = function(f) {	//this is duplicated in iterator.  rationalise? tk
			var x = this.next();
			while (x != null) {
				f(x);
				x = this.next();
			}
		}
		
		iIterate.isIterator = true;
		
		return iIterate;
	}
	
	
	var selectSelfAsNodeList_obsolete = function(cx) {
		if (Object.prototype.toString.call(cx) == "[object Array]") {
			retVal = [cx];
		}
		else {
			retVal = [cx];
		}
		
		return nodelistIterator(retVal);
	}
	
	var selectSelfAsNodeList = function(cx) {	
		return nodelistIterator([cx]);
	}

var fCount = 0;
	
	var filter = function(args) {	

		var predicateFunc = args.pop();	//this is child function not comparator.
		
		var inputArray = [];
		var filterCount = args.length;	//filters will have been added in reverse order
		var repeaterFunc = repeater(filterCount);	//this returns a function that will return the same context to all inputs
		var inputContext = null;  //this will end up being a repeater which inputContextIterator delegates to
				
		var inputContextIterator = function() {
			//inputContextIterator 
		}

		inputContextIterator.next = function () {
		var x = inputContext.next();		
			return x;
		}
		
		inputContextIterator.reset = function () {
			//what does it mean to reset the repeater - would we ever redo a context?
		}
		
		for (var i = filterCount; i > 0; i--) {
			var inputInfo = args.pop();
			//inputInfo : {head, tail} 
			inputArray.push(inputInfo.tail); //tail is where we get next input from 
				
			//the context for the input head is filter - but this is the repeater function that passes on filter's own context - not the one exposed to children of the filter
			//need to pass in a function that will return A.next() - this is a function that will need repeater for each input there is - here selectorFunc points to that
			inputInfo.head.setContextIterator(inputContextIterator); //head gets its context from this filter (which should be part-handled by the repeater function)
		}
		
		// filter needs to be an iterator - can we do this by inheritence?			
		var f = function() {
			
		
			var index = 0;	
			//var dataIterator = nullIterator;
			//var contextIterator = null;
			//this.complete = false;	//flag indicating whether to stop on first result or not. not sure that the filter needs this.  fiter needs more an indicator of whether to test all values	
		}
		f.ff = fCount++;
		
		//these f. values we could perhaps put in the filter scope.
		f.complete = false;
		f.nullIterator = {
				next : function() {
					return null;
				},
				reset : function() {
					console.log("null iterator reset does get called");
				}
			};
		f.dataIterator = f.nullIterator;
		f.contextIterator = null;
		f.next = function() {
			var retVal = null;
			//create a loop until any one of the inputs is null
			
			if (this.complete == false) {
				retVal = this.dataIterator.next();
				
				while (retVal == null) {
					//get the next parent context
					dataIterator = this.getIterator();
					
					if (dataIterator == null) {
						break;	//no more parent contexts
					}
					
					//what we are getting is underlying js data object - not an iterator.
					
					retVal = dataIterator.next();
					
					if ((retVal != null) && (this.mode == enumMode.SINGLE)) {
					
						complete = true;
					}
				}
			}
			
			return retVal;
		}
		
		f.getIterator = function() {
			var retVal = null;
			
			//get context from parent iterator
			var parentContext = this.contextIterator.next();					
			
			if (parentContext != null)  {
			
				//we have a new root for all input iterator chains.
				inputContext = repeaterFunc(parentContext);
				
				retVal = f.selectorFunc(parentContext);
				
			}
			
			//reset input iterator chains
			inputArray.forEach(function(d) {
			
				d.reset();
				
			});
			
			
			return retVal;
		}
		
		f.reset = function() {
			index = 0;
			complete = false;
			//all input iterators need resetting from tail up.
			for (var i = 0 ; i < inputArray.length; i++) {
				inputArray[i].reset();
			}
			//and this filters context needs resetting
			this.contextIterator.reset();
		}			
		
		f.setContextIterator = function(it) {
			
			this.contextIterator = it;			
		};
		
		f.selectorFunc = function(cx) {
		
			//this function iterates through inputs until it comes to a match or runs out of inputs (need a flag to test if inputs need to be exhaustively tested.
			var isNull = false;
			//var complete = false;	
			var result = false;	
			var retVal = null;				
			var inputs = null;
			
			//need to build in mechanism to allow for exhautive testing of inputs. regression.
			
			while (result == false) {
			
				inputs = inputArray.map(function(d) {
				
					var x = d.next(); //when this next is called it appears to be running through all its values until it gets to null
					
					if(x == null) {							
						//not all inputs have a value - which for the moment means abort - break out of map function by setting result to true
						result = true;
					}
				
					return x;
				});
				
				if (result == false) {					
					if (inputs[0] != null) {
						//console.log(inputs[0]);
					}
					else {
						console.log("null input");
					}
					if (inputs[1] != null) {
						//console.log(inputs[1]);
					}
					else {
						console.log("null input");
					}
					
					result = predicateFunc(inputs);					
					if (result == true) {
						retVal = cx;
					}
					
				}
				else {
					//console.log("no inputs");
				}
			}
			
			
			return selectSelfAsNodeList(retVal);	//retVal is either cx or null
			//return retVal;
		}

		f.funcType = enumFuncType.FILTER;
		return f;
	}
	
	filter.argCount = 1;
	filter.name = "filter";
			
	
	var repeater = function(repeatCount) {
		//if we run this function twice do we get separate copies of repeatIndex and repeatCount or do they overwrite?  Is f a singleton? tk
		var repeatIndex = 0;
		
		var f = function(cx) {
			var result = [];
			for (var i = 0; i < repeatCount - 1; i++) { //-1 is only temporary - but we only want to include xpath chains, not literals in inputs
				result.push(cx);			
			}
			
			return nodelistIterator(result);	//this returns a node list iterator - if result is not an array it is put into one - although this may not be what one wants

			//if you are doing a search for an array element, then you want that...do we have a way of getting the underlying data item and not an iterator?
		}
		f.funcType = enumFuncType.SELECTOR;	//do we need this?
		return f;
	}
	
	repeater.argCount = 1; //better to put these in with the functions?
	repeater.name = "repeater";
	