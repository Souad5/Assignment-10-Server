const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.0evfqhu.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});


let listingsCollection;

// Connect to DB or reuse existing connection
async function connectToDB() {
  if (listingsCollection) return listingsCollection;

  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
      console.log("✅ Connected to MongoDB");
    }
    const db = client.db("roommateFinder");
    listingsCollection = db.collection("roommateListings");
    return listingsCollection;
  } catch (err) {
    console.error("❌ Failed to connect to DB:", err);
    throw err;
  }
}

// Root route
app.get("/", (req, res) => {
  res.send("🚀 Roommate Finder API Running");
});

// Get listings by user email
app.get("/listings", async (req, res) => {
  try {
    const collection = await connectToDB();
    const email = req.query.email;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const listings = await collection.find({ email }).toArray();
    res.json(listings);
  } catch (err) {
    console.error("Get listings error:", err);
    res.status(503).json({ message: "Database not ready. Try again later." });
  }
});

// Get 6 featured listings
app.get("/listings/featured", async (req, res) => {
  try {
    const collection = await connectToDB();
    const featured = await collection.find({ availability: "Available" }).limit(6).toArray();
    res.json(featured);
  } catch (err) {
    console.error("Get featured listings error:", err);
    res.status(503).json({ message: "Database not ready. Try again later." });
  }
});

// Get all listings
app.get("/listings/all", async (req, res) => {
  try {
    const collection = await connectToDB();
    const allListings = await collection.find().toArray();
    res.json(allListings);
  } catch (err) {
    console.error("Get all listings error:", err);
    res.status(503).json({ message: "Database not ready. Try again later." });
  }
});

// Add a new listing
app.post("/listings", async (req, res) => {
  try {
    const collection = await connectToDB();
    const result = await collection.insertOne(req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error("Add listing error:", err);
    res.status(503).json({ message: "Database not ready. Try again later." });
  }
});

// Get a listing by ID
app.get("/listings/:id", async (req, res) => {
  try {
    const collection = await connectToDB();
    const listing = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (listing) res.json(listing);
    else res.status(404).json({ message: "Listing not found" });
  } catch (err) {
    console.error("Get listing by ID error:", err);
    res.status(400).json({ message: "Invalid ID" });
  }
});

// Update a listing by ID (only by owner)
app.put("/listings/:id", async (req, res) => {
  try {
    const collection = await connectToDB();
    const id = req.params.id;
    const updateData = { ...req.body };

    console.log("Update request id:", id);
    console.log("Update body:", updateData);

    // Find existing listing
    const listing = await collection.findOne({ _id: new ObjectId(id) });
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    console.log("Listing from DB:", listing);

    // Verify ownership by matching email (userEmail in updateData)
    if (!updateData.email) {
      return res.status(400).json({ message: "Email required for update authorization" });
    }
    if (listing.email !== updateData.email) {
      return res.status(403).json({ message: "Unauthorized to update this listing" });
    }

    // Remove readonly fields from update
    delete updateData.email;
    delete updateData.userName;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // Perform update
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.modifiedCount > 0) {
      res.json({ message: "Listing updated" });
    } else {
      res.status(200).json({ message: "No changes made" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(400).json({ message: "Invalid ID or update failed" });
  }
});

// Delete a listing (only by owner)
app.delete("/listings/:id", async (req, res) => {
  try {
    const collection = await connectToDB();
    const id = req.params.id;
    const email = req.query.email;

    console.log("Delete request id:", id);
    console.log("Delete query email:", email);

    if (!email) {
      return res.status(400).json({ message: "Email query parameter required" });
    }

    const listing = await collection.findOne({ _id: new ObjectId(id) });
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    console.log("Listing from DB:", listing);

    if (listing.email !== email) {
      return res.status(403).json({ message: "Unauthorized to delete this listing" });
    }

    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount > 0) {
      res.json({ message: "Listing deleted" });
    } else {
      res.status(404).json({ message: "Listing not found" });
    }
  } catch (error) {
    console.error("Delete error:", error);
    res.status(400).json({ message: "Invalid ID" });
  }
});

// Like a listing (authenticated & not by owner)
app.put("/listings/:id/like", async (req, res) => {
  try {
    const collection = await connectToDB();
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!userEmail) return res.status(400).json({ message: "User email is required" });

    const listing = await collection.findOne({ _id: new ObjectId(id) });
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    if (listing.email === userEmail) {
      return res.status(403).json({ message: "You cannot like your own post" });
    }

    const updated = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { likeCount: 1 } }
    );

    if (updated.modifiedCount > 0) {
      const updatedListing = await collection.findOne({ _id: new ObjectId(id) });
      res.json({ message: "Liked", likeCount: updatedListing.likeCount });
    } else {
      res.status(500).json({ message: "Failed to update like count" });
    }
  } catch (error) {
    console.error("Like update error:", error);
    res.status(400).json({ message: "Invalid request" });
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await client.close();
  console.log("🛑 MongoDB disconnected. Server shutting down.");
  process.exit(0);
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
