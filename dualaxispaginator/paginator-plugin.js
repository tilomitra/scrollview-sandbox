/*jslint nomen:true sloppy:true white:true*/
/*global Y*/

YUI().add('paginator-plugin', function (Y) {

/**
 * Provides a plugin, which adds pagination support to ScrollView instances
 *
 * @module scrollview-paginator
 */
var getClassName = Y.ClassNameManager.getClassName,
    SCROLLVIEW = 'scrollview',
    CLASS_HIDDEN = getClassName(SCROLLVIEW, 'hidden'),
    CLASS_PAGED = getClassName(SCROLLVIEW, 'paged'),
    UI = (Y.ScrollView) ? Y.ScrollView.UI_SRC : "ui",
    INDEX = "index",
    SCROLL_X = "scrollX",
    SCROLL_Y = "scrollY",
    TOTAL = "total",
    HOST = "host",
    BOUNDING_BOX = "boundingBox",
    CONTENT_BOX = "contentBox",
    SELECTOR = "selector",
    FLICK = "flick",
    DRAG = "drag";

/**
 * Scrollview plugin that adds support for paging
 *
 * @class ScrollViewPaginator
 * @namespace Plugin
 * @extends Plugin.Base
 * @constructor
 */
function PaginatorPlugin() {
    PaginatorPlugin.superclass.constructor.apply(this, arguments);
}

/**
 * The identity of the plugin
 *
 * @property NAME
 * @type String
 * @default 'paginatorPlugin'
 * @static
 */
PaginatorPlugin.NAME = 'pluginScrollViewPaginator';

/**
 * The namespace on which the plugin will reside
 *
 * @property NS
 * @type String
 * @default 'pages'
 * @static
 */
PaginatorPlugin.NS = 'pages';

/**
 * The default attribute configuration for the plugin
 *
 * @property ATTRS
 * @type Object
 * @static
 */
PaginatorPlugin.ATTRS = {

    /**
     * CSS selector for a page inside the scrollview. The scrollview
     * will snap to the closest page.
     *
     * @attribute selector
     * @type {String}
     */
    selector: {
        value: null
    },

    /**
     * The active page number for a paged scrollview
     *
     * @attribute index
     * @type {Number}
     * @default 0
     */
    index: {
        value: 0
    },

    /**
     * The total number of pages
     *
     * @attribute total
     * @type {Number}
     * @default 0
     */
    total: {
        value: 0
    }
};

Y.extend(PaginatorPlugin, Y.Plugin.Base, {

    optimizeMemory: false,
    padding: 1,
    _uiEnabled: true,
    _prevent: new Y.Do.Prevent(),
    cards: [],

    /**
     * Designated initializer
     *
     * @method initializer
     */
    initializer: function (config) {
        var paginator = this,
            host = paginator.get(HOST),
            cb = host.get(CONTENT_BOX),
            optimizeMemory = config.optimizeMemory || paginator.optimizeMemory,
            padding = config.padding || paginator.padding;

        this._cb = cb;

        paginator.padding = padding;
        paginator.optimizeMemory = optimizeMemory;
        paginator._host = host;
        paginator._hostOriginalFlick = host.get(FLICK);
        paginator._hostOriginalDrag = host.get(DRAG);

        paginator.beforeHostMethod('_onGestureMoveStart', paginator._onGestureMoveStart);
        paginator.beforeHostMethod('_onGestureMove', paginator._onGestureMove);
        paginator.beforeHostMethod('_onGestureMoveEnd', paginator._onGestureMoveEnd);
        paginator.beforeHostMethod('_flick', paginator._flick);
        paginator.beforeHostMethod('_mousewheel', paginator._mousewheel);
        paginator.beforeHostMethod('scrollTo', paginator._hostScrollTo);

        paginator.afterHostMethod('_uiDimensionsChange', paginator._afterHostUIDimensionsChange);
        
        paginator.afterHostEvent('render', paginator._afterHostRender);
        paginator.afterHostEvent('scrollEnd', paginator._scrollEnded);

        // On instead of After because we want to detect same value updates
        paginator.after('indexChange', paginator._afterIndexChange);
    },

    /**
     * After host render handler
     *
     * @method _afterHostRender
     * @param {Event.Facade}
        * @protected
     */
    _afterHostRender: function (e) {
        console.log('_afterHostRender');
        var paginator = this,
            host = paginator._host,
            pageNodes = paginator._getPageNodes(),
            size = pageNodes.size(),
            bb = host.get(BOUNDING_BOX);

        pageNodes.each(function(node, i){
            paginator.cards[i] = {
                scrollX: 0,
                scrollY: 0
            }
        });
        bb.addClass(CLASS_PAGED);
        paginator.set(TOTAL, size);
        paginator._optimize();
    },

    /**
     * After host _uiDimensionsChange
     *
     * @method _afterHostUIDimensionsChange
     * @param {Event.Facade}
        * @protected
     */
    _afterHostUIDimensionsChange: function(e) {
        var paginator = this
            pageNodes = paginator._getPageNodes();

        paginator.set(TOTAL, pageNodes.size());
    },

    // Does not prevent
    _onGestureMoveStart: function(e){
        var paginator = this,
            host = paginator._host,
            gesture = host._gesture,
            index = paginator.get(INDEX),
            pageNodes = paginator._getPageNodes(),
            cardNode = pageNodes.item(index);

        // Store the mouse starting point (e.clientY) for this gesture
        paginator.cards[index]._prevY = e.clientY;
        paginator.cards[index].node = cardNode;
    },

    // Prevents
    _onGestureMove: function(e){

        if (this._host._prevent.move) {
            e.preventDefault();
        }

        var paginator = this,
            host = paginator._host,
            gesture = host._gesture,
            index = paginator.get(INDEX),
            startClientX = gesture.startClientX,
            startClientY = gesture.startClientY,
            isVertical,
            delta;

        if (gesture.isVertical == null) {
            gesture.isVertical = (Math.abs(e.clientX - gesture.startClientX) < Math.abs(e.clientY - gesture.startClientY));
        }

        isVertical = gesture.isVertical;

        host._isDragging = true;
        gesture.endClientY = e.clientY;
        gesture.endClientX = e.clientX;

        if (isVertical) {

            // Figure out the movement delta and add it to the previous scrolled amount
            paginator.cards[index].scrollY -= e.clientY - paginator.cards[index]._prevY;

            // Set the scrollY coordinate calculated above
            paginator._hostScrollTo(null, paginator.cards[index].scrollY);

            // Store previous y coordinate
            paginator.cards[index]._prevY = e.clientY;
        }
        else {
            host.set(SCROLL_X, -(e.clientX - gesture.startX));
        }

        return paginator._prevent;
    },

    /**
     * Over-rides the host _onGestureMoveEnd method
     * Executed on flicks at end of strip, or low velocity flicks that are not enough to advance the page.
     *
     * @method _onGestureMoveEnd
     * @protected
     */
     // Does not prevent
    _onGestureMoveEnd: function (e) {
        var paginator = this,
            host = paginator._host,
            gesture = host._gesture,
            isVertical = gesture.isVertical,
            isForward = !isVertical ? gesture.startClientX > gesture.endClientX : gesture.startClientY > gesture.endClientY,
            index = paginator.get(INDEX),
            offsetY;

        if (isVertical) {
            // offsetY is negative when the user pulls the card down past its top margin
            offsetY = paginator.cards[index].scrollY;
            // If pulled down past top
            if (offsetY < 0) {
                offsetY = 0;
                // Reset offsetY to 0 and scrollTo top with animation
                host.scrollTo(null, offsetY, 400, this.cards[index].node);
            }

            paginator.cards[index].scrollY = offsetY;
        }
        else {
            if (isForward) {
                paginator.next();
            }
            else {
                paginator.prev();
            }
        }

        return paginator._prevent;
    },

    /**
     * Executed to respond to the flick event, by over-riding the default flickFrame animation.
     * This is needed to determine if the next or prev page should be activated.
     *
     * @method _flick
     * @protected
     */
    _flick: function () {
        var paginator = this,
            host = paginator._host,
            gesture = host._gesture,
            isVertical = gesture.isVertical,
            velocity = gesture.velocity;

        if (!isVertical) {
            return paginator._prevent;
        }
    },

    /**
     * Executed to respond to the mousewheel event, by over-riding the default mousewheel method.
     *
     * @method _mousewheel
     * @param {Event.Facade}
        * @protected
     */
    _mousewheel: function (e) {
        var paginator = this,
            host = paginator._host,
            isForward = e.wheelDelta < 0, // down (negative) is forward.  @TODO Should revisit.
            cb = this._cb;

        // Only if the mousewheel event occurred on a DOM node inside the CB
        if (cb.contains(e.target)){
            if (isForward) {
                paginator.next();
            }
            else {
                paginator.prev();
            }

            // prevent browser default behavior on mousewheel
            e.preventDefault();

            // Block host._mousewheel from running
            return paginator._prevent;
        }
    },

    _hostScrollTo: function(x, y, duration){
        if (x === this._host.get('scrollX') && y === this._host.get('scrollY')) {
            return false;
        }

        var paginator = this,
            host = paginator._host,
            gesture = host._gesture,
            isVertical = gesture.isVertical,
            index = paginator.get(INDEX),
            transition = {
                easing : 'ease-out',
                duration : duration/1000
            },
            callback = this._transEndCB;

        if (isVertical) {
            var index = paginator.get(INDEX);
            if (duration) {
                transition.transform = 'translateY(' + -y + 'px) translateZ(0px)';
                this.cards[index].node.transition(transition);
            }
            else {
                this.cards[index].node.setStyle('transform', 'translateY(' + -y + 'px) translateZ(0px)');
            }

            // Store last known y offset
            this.cards[index].scrollY = y;

        }
        else {
            var cb = this._cb;

            // TODO:
            //     - consider using host's _transform
            //     - consider replacing setStyle with a 0 duration transition on the else
            if (duration) {
                if (!callback) {
                    callback = this._host._transEndCB = Y.bind(this._host._onTransEnd, this._host);
                }

                transition.transform = 'translateX('+ -x +'px) translateZ(0px)';
                cb.transition(transition, callback);
            }
            else {
                cb.setStyle('transform', 'translateX('+ -x +'px) translateZ(0px)');
            }
        }
        return paginator._prevent;
    },

    /**
     * scrollEnd handler to run some cleanup operations
     *
     * @method _scrollEnded
     * @param {Event.Facade}
        * @protected
     */
    _scrollEnded: function (e) {
        var paginator = this,
            currentIndex = paginator.get(INDEX);

        // paginator._optimize();
        this._uiEnable();
    },

    /**
     * index attr change handler
     *
     * @method _afterIndexChange
     * @param {Event.Facade}
        * @protected
     */
    _afterIndexChange: function (e) {
        var paginator = this,
            newVal = e.newVal;

        if(e.src !== UI) {
            paginator.scrollToIndex(newVal);
        }
    },

    /**
     * Improves performance by hiding page nodes not near the viewport
     *
     * @method _optimize
     * @protected
     */
    _optimize: function() {
        var paginator = this,
            host = paginator._host,
            optimizeMemory = paginator.optimizeMemory,
            isVert = host._scrollsVertical,
            currentIndex = paginator.get(INDEX),
            pageNodes;

        if (!optimizeMemory) {
            return false;
        }

        // Show the pages in/near the viewport & hide the rest
        pageNodes = paginator._getStage(currentIndex);
        paginator._showNodes(pageNodes.visible);
        paginator._hideNodes(pageNodes.hidden);
        // paginator.scrollToIndex(currentIndex, 0);
    },

    /**
     * Determines which nodes should be visible, and which should be hidden.
     *
     * @method _getStage
     * @param index {Number} The page index # intended to be in focus.
     * @returns {object}
     * @protected
     */
    _getStage : function (index) {
        var paginator = this,
            host = paginator._host,
            padding = paginator.padding,
            visibleCount = padding + 1 + padding, // Before viewport | viewport | after viewport
            pageNodes = paginator._getPageNodes(),
            pageCount = paginator.get(TOTAL),
            start, visible, hidden;

        // Somehow this works.  @TODO cleanup
        start = Math.max(index-padding, 0);
        if (start+visibleCount > pageCount) {
            start = start-(start+visibleCount-pageCount);
        }

        visible = pageNodes.splice(start, visibleCount);
        hidden = pageNodes; // everything leftover

        return {
            visible: visible,
            hidden: hidden
        };
    },

    /**
     * A utility method to show node(s)
     *
     * @method _showNodes
     * @param nodeList {nodeList}
     * @protected
     */
    _showNodes : function (nodeList) {
        var host = this._host,
            cb = host.get(CONTENT_BOX);

        if (nodeList) {
            nodeList.removeClass(CLASS_HIDDEN).setStyle('display', '');
        }
    },

    /**
     * A utility method to hide node(s)
     *
     * @method _hideNodes
     * @param nodeList {nodeList}
     * @protected
     */
    _hideNodes : function (nodeList) {
        var host = this._host;

        if (nodeList) {
            nodeList.addClass(CLASS_HIDDEN).setStyle('display', 'none');
        }
    },

    /**
     * Enable UI interaction with the widget
     *
     * @method _uiEnable
     * @protected
     */
    _uiEnable: function () {
        var paginator = this,
            host = paginator._host,
            disabled = !paginator._uiEnabled;

        if (disabled) {
            // paginator._uiEnabled = true;
            // host.set(FLICK, paginator._hostOriginalFlick);
            // host.set(DRAG, paginator._hostOriginalDrag);
        }
    },

    /**
     * Disable UI interaction with the widget
     *
     * @method _uiDisable
     * @protected
     */
    _uiDisable: function () {
        var paginator = this,
            host = paginator._host;

        // paginator._uiEnabled = false;
        // host.set(FLICK, false);
        // host.set(DRAG, false);
    },

    /**
     * Gets a nodeList for the "pages"
     *
     * @method _getPageNodes
     * @protected
     * @returns {nodeList}
     */
    _getPageNodes: function() {
        var paginator = this,
            host = paginator._host,
            cb = host.get(CONTENT_BOX),
            pageSelector = paginator.get(SELECTOR),
            pageNodes = pageSelector ? cb.all(pageSelector) : cb.get("children");

        return pageNodes;
    },

    /**
     * Scroll to the next page in the scrollview, with animation
     *
     * @method next
     */
    next: function () {
        var paginator = this,
            index = paginator.get(INDEX),
            target = index + 1;

        if(paginator._uiEnabled) {
            paginator.set(INDEX, target);
        }
    },

    /**
     * Scroll to the previous page in the scrollview, with animation
     *
     * @method prev
     */
    prev: function () {
        var paginator = this,
            index = paginator.get(INDEX),
            target = index - 1;
        if (target < 0) {
            target = 0;
        }
        if(paginator._uiEnabled) {
            paginator.set(INDEX, target);
        }
    },

    scrollTo: function () {
        return this.scrollToIndex.apply(this, arguments);
    },

    /**
     * Scroll to a given page in the scrollview
     *
     * @method scrollToIndex
     * @param index {Number} The index of the page to scroll to
     * @param duration {Number} The number of ms the animation should last
     * @param easing {String} The timing function to use in the animation
     */
    scrollToIndex: function (index, duration, easing) {
        
        var paginator = this,
            host = paginator._host,
            isVert = host.isVertical,
            scrollAxis = (isVert) ? SCROLL_Y : SCROLL_X,
            pageNodes = paginator._getPageNodes(),
            startPoint = isVert ? host._startClientY : host._startClientX,
            endPoint = isVert ? host._endClientY : host._endClientX,
            delta = startPoint - endPoint,
            duration = (duration !== undefined) ? duration : PaginatorPlugin.TRANSITION.duration,
            easing = (easing !== undefined) ? duration : PaginatorPlugin.TRANSITION.easing,
            scrollVal;

        // If the delta is 0 (a no-movement mouseclick)
        if (delta === 0) {
            return false;
        }

        // Disable the UI while animating
        if (duration > 0) {
            paginator._uiDisable();
        }

        // Make sure the target node is visible
        paginator._showNodes(pageNodes.item(index));

        // Determine where to scroll to
        if (isVert) {
            scrollVal = pageNodes.item(index).get("offsetTop");
        } else {
            scrollVal = pageNodes.item(index).get("offsetLeft");
        }

        host.set(scrollAxis, scrollVal, {
            duration: duration,
            easing: easing
        });
    }
});

/**
 * The default snap to current duration and easing values used on scroll end.
 *
 * @property SNAP_TO_CURRENT
 * @static
 */
PaginatorPlugin.TRANSITION = {
    duration : 300,
    easing : 'ease-out'
};

Y.namespace('Plugin').ScrollViewPaginator = PaginatorPlugin;

});